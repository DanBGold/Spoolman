"""Integration tests for spool locations built from extra fields."""

import json
import uuid
from collections.abc import Iterable
from typing import Any

import httpx
import pytest

from ..conftest import URL


def _set(key: str, *, value: object) -> None:
    httpx.post(f"{URL}/api/v1/setting/{key}", json=json.dumps(value)).raise_for_status()


def _reset(key: str) -> None:
    # The body is the JSON-encoded value as a JSON string; "null" resets to the default
    # (404 when the setting was never set, which is fine here).
    assert httpx.post(f"{URL}/api/v1/setting/{key}", json="null").status_code in (200, 404)


def _spool(spool_id: int) -> dict[str, Any]:
    result = httpx.get(f"{URL}/api/v1/spool/{spool_id}")
    result.raise_for_status()
    return result.json()


@pytest.fixture
def location_fields() -> Iterable[tuple[str, str, str]]:
    """Room (choice, location), Rack (integer, location) and Note (text, not location)."""
    suffix = uuid.uuid4().hex[:8]
    room, rack, note = f"room_{suffix}", f"rack_{suffix}", f"note_{suffix}"
    httpx.post(
        f"{URL}/api/v1/field/spool/{room}",
        json={
            "name": "Room",
            "field_type": "choice",
            "choices": ["Room A", "Room B"],
            "multi_choice": False,
            "order": 1,
            "location": True,
        },
    ).raise_for_status()
    httpx.post(
        f"{URL}/api/v1/field/spool/{rack}",
        json={"name": "Rack", "field_type": "integer", "order": 2, "location": True},
    ).raise_for_status()
    httpx.post(f"{URL}/api/v1/field/spool/{note}", json={"name": "Note", "field_type": "text"}).raise_for_status()
    yield room, rack, note
    _reset("location_from_extra_fields")
    _reset("location_separator")
    for key in (room, rack, note):
        httpx.delete(f"{URL}/api/v1/field/spool/{key}")


def test_field_location_flag_round_trips(location_fields: tuple[str, str, str]) -> None:
    room, _, note = location_fields
    fields = {f["key"]: f for f in httpx.get(f"{URL}/api/v1/field/spool").json()}
    assert fields[room]["location"] is True
    assert fields[note]["location"] is False


def test_off_by_default_location_is_free_text(
    random_filament: dict[str, Any],
    location_fields: tuple[str, str, str],
) -> None:
    room, rack, _ = location_fields
    result = httpx.post(
        f"{URL}/api/v1/spool",
        json={
            "filament_id": random_filament["id"],
            "location": "Shelf",
            "extra": {room: json.dumps("Room A"), rack: json.dumps(3)},
        },
    )
    result.raise_for_status()
    assert result.json()["location"] == "Shelf"
    httpx.delete(f"{URL}/api/v1/spool/{result.json()['id']}")


def test_create_and_update_compute_location(
    random_filament: dict[str, Any],
    location_fields: tuple[str, str, str],
) -> None:
    room, rack, note = location_fields
    _set("location_from_extra_fields", value=True)
    _set("location_separator", value=" / ")

    result = httpx.post(
        f"{URL}/api/v1/spool",
        json={
            "filament_id": random_filament["id"],
            "location": "ignored",
            "extra": {room: json.dumps("Room A"), rack: json.dumps(3), note: json.dumps("not part")},
        },
    )
    result.raise_for_status()
    spool_id = result.json()["id"]
    assert result.json()["location"] == "Room A / 3"

    # Editing a field updates the location; a location sent directly does not stick.
    result = httpx.patch(
        f"{URL}/api/v1/spool/{spool_id}",
        json={"location": "manual", "extra": {room: json.dumps("Room B")}},
    )
    result.raise_for_status()
    assert result.json()["location"] == "Room B / 3"

    # Clearing a field drops it (and its separator); clearing all clears the location.
    httpx.patch(f"{URL}/api/v1/spool/{spool_id}", json={"extra": {rack: None}}).raise_for_status()
    assert _spool(spool_id)["location"] == "Room B"
    httpx.patch(f"{URL}/api/v1/spool/{spool_id}", json={"extra": {room: None}}).raise_for_status()
    assert "location" not in _spool(spool_id)

    # Any edit recomputes, even one that touches no extra field.
    httpx.patch(f"{URL}/api/v1/spool/{spool_id}", json={"extra": {room: json.dumps("Room A")}}).raise_for_status()
    _set("location_separator", value="-")
    httpx.patch(f"{URL}/api/v1/spool/{spool_id}", json={"comment": "x"}).raise_for_status()
    assert _spool(spool_id)["location"] == "Room A"

    httpx.delete(f"{URL}/api/v1/spool/{spool_id}")


def test_apply_now_updates_existing_spools(
    random_filament: dict[str, Any],
    location_fields: tuple[str, str, str],
) -> None:
    room, rack, _ = location_fields
    result = httpx.post(
        f"{URL}/api/v1/spool",
        json={
            "filament_id": random_filament["id"],
            "location": "Old shelf",
            "extra": {room: json.dumps("Room B"), rack: json.dumps(1)},
        },
    )
    result.raise_for_status()
    spool_id = result.json()["id"]

    # Off: refused, nothing changes.
    assert httpx.post(f"{URL}/api/v1/location/apply-extra-fields").status_code == 400
    assert _spool(spool_id)["location"] == "Old shelf"

    # Turning the setting on alone doesn't touch existing spools...
    _set("location_from_extra_fields", value=True)
    assert _spool(spool_id)["location"] == "Old shelf"

    # ...applying does.
    result = httpx.post(f"{URL}/api/v1/location/apply-extra-fields")
    result.raise_for_status()
    assert result.json()["spools_updated"] >= 1
    assert _spool(spool_id)["location"] == "Room B - 1"

    httpx.delete(f"{URL}/api/v1/spool/{spool_id}")


def test_location_rename_refused_and_extra_rename_recomputes(
    random_filament: dict[str, Any],
    location_fields: tuple[str, str, str],
) -> None:
    _, _, _ = location_fields
    # Use a text field for the rename (choice values can only be renamed through their definition).
    shelf = f"shelf_{uuid.uuid4().hex[:8]}"
    httpx.post(
        f"{URL}/api/v1/field/spool/{shelf}",
        json={"name": "Shelf", "field_type": "text", "location": True, "order": 3},
    ).raise_for_status()
    _set("location_from_extra_fields", value=True)
    try:
        result = httpx.post(
            f"{URL}/api/v1/spool",
            json={"filament_id": random_filament["id"], "extra": {shelf: json.dumps("Top")}},
        )
        result.raise_for_status()
        spool_id = result.json()["id"]
        assert result.json()["location"] == "Top"

        assert (
            httpx.patch(f"{URL}/api/v1/spool/field/location", json={"value": "Top", "new_value": "X"}).status_code
            == 400
        )
        assert httpx.patch(f"{URL}/api/v1/location/Top", json={"name": "X"}).status_code == 400

        httpx.patch(
            f"{URL}/api/v1/spool/field/extra.{shelf}",
            json={"value": "Top", "new_value": "Upper"},
        ).raise_for_status()
        assert _spool(spool_id)["location"] == "Upper"
        httpx.delete(f"{URL}/api/v1/spool/{spool_id}")
    finally:
        httpx.delete(f"{URL}/api/v1/field/spool/{shelf}")
