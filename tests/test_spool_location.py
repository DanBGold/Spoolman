"""How spool extra-field values are turned into a location."""

import json

from spoolman.extra_field_registry import EntityType, ExtraField, ExtraFieldType
from spoolman.spool_location import LOCATION_MAX_LENGTH, LocationConfig, compose


def _field(key: str, typ: ExtraFieldType, **kw: object) -> ExtraField:
    return ExtraField(key=key, name=key.title(), field_type=typ, entity_type=EntityType.spool, location=True, **kw)


ROOM = _field("room", ExtraFieldType.choice, choices=["Room A", "Room B"], multi_choice=False)
RACK = _field("rack", ExtraFieldType.integer)
BINS = _field("bins", ExtraFieldType.choice, choices=["1", "2", "3"], multi_choice=True)
SHELF = _field("shelf", ExtraFieldType.float_range)
DRY = _field("dry", ExtraFieldType.boolean)
CONFIG = LocationConfig(fields=[ROOM, RACK, BINS, SHELF, DRY], separator=" - ")


def enc(**values: object) -> dict[str, str]:
    return {k: json.dumps(v) for k, v in values.items()}


def test_joins_in_field_order_with_separator() -> None:
    assert compose(enc(rack=1, room="Room A"), CONFIG) == "Room A - 1"


def test_skips_empty_and_missing_values() -> None:
    assert compose(enc(room="  ", rack=2), CONFIG) == "2"
    assert compose({}, CONFIG) is None


def test_formats_each_type() -> None:
    assert compose(enc(bins=["1", "3"]), CONFIG) == "1, 3"
    assert compose(enc(shelf=[2.0, 4.5]), CONFIG) == "2-4.5"
    assert compose(enc(dry=True), CONFIG) == "Dry"
    assert compose(enc(dry=False), CONFIG) is None


def test_custom_separator_and_length_cap() -> None:
    config = LocationConfig(fields=[ROOM, RACK], separator="/")
    assert compose(enc(room="Room B", rack=7), config) == "Room B/7"
    long = LocationConfig(fields=[_field("note", ExtraFieldType.text)], separator="-")
    assert len(compose(enc(note="x" * 200), long) or "") == LOCATION_MAX_LENGTH
