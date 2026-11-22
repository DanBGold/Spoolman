"""Filament related endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, RootModel
from sqlalchemy.ext.asyncio import AsyncSession

from spoolman import spool_location
from spoolman.api.v1.models import Message
from spoolman.database import filament, spool
from spoolman.database.database import get_db_session

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="",
    tags=["other"],
)

# ruff: noqa: D103


@router.get(
    "/material",
    name="Find materials",
    description="Get a list of all filament materials.",
    response_model_exclude_none=True,
    responses={
        200: {
            "description": "A list of all filament materials.",
            "content": {
                "application/json": {
                    "example": [
                        "PLA",
                        "ABS",
                        "PETG",
                    ],
                },
            },
        },
    },
)
async def find_materials(
    *,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[str]:
    return await filament.find_materials(db=db)


@router.get(
    "/article-number",
    name="Find article numbers",
    description="Get a list of all article numbers.",
    response_model_exclude_none=True,
    responses={
        200: {
            "description": "A list of all article numbers.",
            "content": {
                "application/json": {
                    "example": [
                        "123456",
                        "987654",
                    ],
                },
            },
        },
    },
)
async def find_article_numbers(
    *,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[str]:
    return await filament.find_article_numbers(db=db)


@router.get(
    "/lot-number",
    name="Find lot numbers",
    description="Get a list of all lot numbers.",
    response_model_exclude_none=True,
    responses={
        200: {
            "description": "A list of all lot numbers.",
            "content": {
                "application/json": {
                    "example": [
                        "123456",
                        "987654",
                    ],
                },
            },
        },
    },
)
async def find_lot_numbers(
    *,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[str]:
    return await spool.find_lot_numbers(db=db)


@router.get(
    "/location",
    name="Find locations",
    description="Get a list of all spool locations.",
    response_model_exclude_none=True,
    responses={
        200: {
            "description": "A list of all spool locations.",
            "content": {
                "application/json": {
                    "example": [
                        "Printer 1",
                        "Printer 2",
                        "Storage Shelf A",
                    ],
                },
            },
        },
    },
)
async def find_locations(
    *,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[str]:
    return await spool.find_locations(db=db)


class RenameLocationBody(BaseModel):
    name: str = Field(description="The new name of the location.", min_length=1)


@router.patch(
    "/location/{location:path}",
    name="Rename location",
    description="Rename a spool location. All spools in this location will be moved to the new location.",
    response_model_exclude_none=True,
    response_model=RootModel[str],
    responses={400: {"model": Message}},
)
async def rename_location(
    location: str,
    *,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    body: RenameLocationBody,
) -> str | JSONResponse:
    logger.info("Renaming location %s to %s", location, body.name)
    try:
        await spool.rename_location(db=db, current_name=location, new_name=body.name)
    except ValueError as e:
        return JSONResponse(status_code=400, content=Message(message=str(e)).model_dump())
    return body.name


class ApplyLocationsResult(BaseModel):
    spools_updated: int = Field(description="How many spools got a different location.")


@router.post(
    "/location/apply-extra-fields",
    name="Build locations from extra fields",
    description=(
        "Recompute every spool's location from its extra fields flagged as location, joined by the "
        "location_separator setting. Only does anything while the location_from_extra_fields "
        "setting is on."
    ),
    response_model=ApplyLocationsResult,
    responses={400: {"model": Message}},
)
async def apply_locations_from_extra_fields(
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> ApplyLocationsResult | JSONResponse:
    if not await spool_location.is_enabled(db):
        return JSONResponse(
            status_code=400,
            content=Message(message="The location_from_extra_fields setting is off.").model_dump(),
        )
    return ApplyLocationsResult(spools_updated=await spool_location.recompute_all(db))
