"""Integration tests for the filament transmission distance (TD) field."""

from typing import Any

import httpx
import pytest

from ..conftest import URL


def _create(vendor_id: int, **extra: object) -> httpx.Response:
    return httpx.post(
        f"{URL}/api/v1/filament",
        json={"name": "TD test", "vendor_id": vendor_id, "density": 1.24, "diameter": 1.75, **extra},
    )


def test_td_create_update_clear(random_vendor: dict[str, Any]) -> None:
    result = _create(random_vendor["id"], td=4.9)
    result.raise_for_status()
    filament = result.json()
    assert filament["td"] == pytest.approx(4.9)

    result = httpx.patch(f"{URL}/api/v1/filament/{filament['id']}", json={"td": 100})
    result.raise_for_status()
    assert result.json()["td"] == pytest.approx(100)

    # Other edits leave TD alone.
    result = httpx.patch(f"{URL}/api/v1/filament/{filament['id']}", json={"comment": "x"})
    assert result.json()["td"] == pytest.approx(100)

    # Null clears it; the API then omits the field.
    result = httpx.patch(f"{URL}/api/v1/filament/{filament['id']}", json={"td": None})
    result.raise_for_status()
    assert "td" not in result.json()

    httpx.delete(f"{URL}/api/v1/filament/{filament['id']}").raise_for_status()


def test_td_optional(random_vendor: dict[str, Any]) -> None:
    result = _create(random_vendor["id"])
    result.raise_for_status()
    assert "td" not in result.json()
    httpx.delete(f"{URL}/api/v1/filament/{result.json()['id']}").raise_for_status()


@pytest.mark.parametrize("td", [-0.1, 100.1])
def test_td_out_of_range(random_vendor: dict[str, Any], td: float) -> None:
    assert _create(random_vendor["id"], td=td).status_code == 422
