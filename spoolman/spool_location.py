"""Spool locations built from the spool's extra fields.

With the ``location_from_extra_fields`` setting on, a spool's location is not typed in: it is
composed from the spool extra fields flagged ``location`` (in field order), joined by the
``location_separator`` setting -- e.g. Room "Room A" and Rack 1 with " - " give "Room A - 1".
The location is then recomputed whenever a spool is created or edited, so it always follows
the fields, and attempts to set it directly are overridden.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

import sqlalchemy

from spoolman.database import models
from spoolman.database import setting as db_setting
from spoolman.exceptions import ItemNotFoundError
from spoolman.extra_field_registry import EntityType, ExtraField, get_extra_fields
from spoolman.settings import parse_setting

if TYPE_CHECKING:
    from collections.abc import Iterable

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Mirrors the Spool.location column width.
LOCATION_MAX_LENGTH = 64


@dataclass(frozen=True)
class LocationConfig:
    """What a computed location is made of."""

    fields: list[ExtraField]
    separator: str


async def _setting_value(db: AsyncSession, key: str) -> object:
    definition = parse_setting(key)
    try:
        raw = (await db_setting.get(db, definition)).value
    except ItemNotFoundError:
        raw = definition.default
    return json.loads(raw)


async def is_enabled(db: AsyncSession) -> bool:
    """Whether locations are computed from extra fields."""
    return bool(await _setting_value(db, "location_from_extra_fields"))


async def get_config(db: AsyncSession) -> LocationConfig | None:
    """Return the active configuration, or None when locations are entered by hand."""
    if not await is_enabled(db):
        return None
    separator = await _setting_value(db, "location_separator")
    fields = sorted(
        (f for f in await get_extra_fields(db, EntityType.spool) if f.location),
        key=lambda f: (f.order, f.key),
    )
    return LocationConfig(fields=fields, separator=separator if isinstance(separator, str) else " - ")


def _number(value: float) -> str:
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)


def _part(raw: str | None, field: ExtraField) -> str | None:  # noqa: PLR0911
    """Return the text one extra field contributes to the location, or None when it has no value."""
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip() or None
    if value is None:
        return None
    if isinstance(value, bool):
        # A ticked checkbox contributes its name ("Dry box"); an unticked one nothing.
        return field.name if value else None
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, list):
        items = [_number(v) if isinstance(v, (int, float)) else str(v) for v in value if v is not None]
        if not items:
            return None
        # Ranges read as "1-5", multi-choice selections as "A, B".
        joiner = "-" if field.field_type.value.endswith("_range") else ", "
        return joiner.join(items)
    text = str(value).strip()
    return text or None


def compose(extra: dict[str, str], config: LocationConfig) -> str | None:
    """Build a location from a spool's extra values (key -> JSON-encoded value)."""
    parts = [p for f in config.fields if (p := _part(extra.get(f.key), f)) is not None]
    if not parts:
        return None
    return config.separator.join(parts)[:LOCATION_MAX_LENGTH]


def extra_of(fields: Iterable[models.SpoolField]) -> dict[str, str]:
    """Return a spool's extra rows as a key -> value dict."""
    return {f.key: f.value for f in fields}


async def recompute_all(db: AsyncSession) -> int:
    """Recompute every spool's location from its extra fields; returns how many changed.

    Does nothing (returns 0) when the feature is off. Like the bulk location rename, no
    per-spool websocket event is sent; clients pick the change up on their next load.
    """
    config = await get_config(db)
    if config is None:
        return 0
    result = await db.execute(sqlalchemy.select(models.Spool))
    changed = 0
    for spool in result.unique().scalars().all():
        location = compose(extra_of(spool.extra), config)
        if spool.location != location:
            spool.location = location
            changed += 1
    await db.commit()
    logger.info("Recomputed spool locations from extra fields: %d changed.", changed)
    return changed
