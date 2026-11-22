"""Tests for the report_designs setting used by the report generator."""

import json

import pytest

from spoolman.settings import SettingType, parse_setting


def test_report_designs_is_registered_as_empty_array() -> None:
    setting = parse_setting("report_designs")
    assert setting.type == SettingType.ARRAY
    assert json.loads(setting.default) == []


def test_report_designs_accepts_an_array_of_designs() -> None:
    setting = parse_setting("report_designs")
    setting.validate_type(json.dumps([{"id": "r1", "name": "Spools by location", "columns": []}]))


def test_report_designs_rejects_a_non_array() -> None:
    setting = parse_setting("report_designs")
    with pytest.raises(ValueError):  # noqa: PT011
        setting.validate_type(json.dumps({"id": "r1"}))
