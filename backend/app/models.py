from __future__ import annotations

from pydantic import BaseModel


class GameListItem(BaseModel):
    appid: int
    name: str
    library_capsule: str
    tier: str


class GamePage(BaseModel):
    items: list[GameListItem]
    page: int
    limit: int
    total: int


class Requirements(BaseModel):
    minimum: str
    recommended: str


class GameDetail(BaseModel):
    appid: int
    name: str
    library_capsule: str
    genre: list[str]
    tier: str
    pc_requirements: Requirements


class HealthResponse(BaseModel):
    status: str
    catalog_version: int
    latest_remote_version: int | None = None
    last_update_status: str | None = None


class StatsResponse(BaseModel):
    actual_count: int
    display_count: int
