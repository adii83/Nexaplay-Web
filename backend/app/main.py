from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .catalog_repository import CatalogRepository
from .catalog_updater import CatalogUpdater, UpdateResult
from .config import Settings
from .database import CatalogDatabase
from .models import GameDetail, GameListItem, GamePage, HealthResponse, StatsResponse
from .priority_service import PriorityService, PriorityUnavailable
from .stats_service import DisplayStatsService


LOG = logging.getLogger(__name__)
MAX_IDS = 100


def parse_ids(value: str) -> list[int]:
    if not value.strip():
        raise ValueError("ids must not be empty")
    result: list[int] = []
    seen: set[int] = set()
    for raw in value.split(","):
        token = raw.strip()
        if not token.isdecimal() or int(token) <= 0:
            raise ValueError("ids must contain positive integers")
        appid = int(token)
        if appid not in seen:
            seen.add(appid)
            result.append(appid)
        if len(result) > MAX_IDS:
            raise ValueError(f"ids supports at most {MAX_IDS} unique values")
    return result


def load_ordered_appids(path: Path) -> list[int]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to read trending AppIDs: {path}") from error
    if not isinstance(payload, list):
        raise ValueError("Trending AppID payload must be a JSON array")
    result: list[int] = []
    seen: set[int] = set()
    for raw in payload:
        if isinstance(raw, int) and not isinstance(raw, bool) and raw > 0 and raw not in seen:
            seen.add(raw)
            result.append(raw)
    if not result:
        raise ValueError("Trending AppID payload has no valid IDs")
    return result


def create_app(
    settings: Settings | None = None,
    *,
    start_background: bool | None = None,
    priority_service: PriorityService | None = None,
    stats_service: DisplayStatsService | None = None,
    updater: CatalogUpdater | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    if start_background is None:
        start_background = settings.background_updates
    database = CatalogDatabase(settings.catalog_db)
    database.validate()
    repository = CatalogRepository(database)
    priority = priority_service or PriorityService(
        url=settings.priority_url,
        cache_path=settings.priority_cache,
        refresh_seconds=settings.priority_refresh_seconds,
        timeout_seconds=settings.network_timeout_seconds,
    )
    display_stats = stats_service or DisplayStatsService(settings.display_stats_path)
    catalog_updater = updater or CatalogUpdater(
        database,
        settings.manifest_url,
        settings.network_timeout_seconds,
    )
    update_state: dict[str, UpdateResult | None] = {"result": None}

    async def update_loop() -> None:
        while True:
            update_state["result"] = await asyncio.to_thread(catalog_updater.check_and_apply)
            await asyncio.sleep(settings.update_interval_seconds)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        task = asyncio.create_task(update_loop()) if start_background else None
        yield
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="NexaPlay Catalog API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
    )

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> dict[str, object]:
        result = update_state["result"]
        return {
            "status": "ok",
            "catalog_version": database.catalog_version(),
            "latest_remote_version": result.latest_remote_version if result else None,
            "last_update_status": result.status if result else None,
        }

    @app.get("/api/games", response_model=GamePage)
    async def games(
        q: str = Query("", max_length=120),
        tier: str | None = Query(None, pattern="^(premium|standard)$"),
        page: int = Query(1, ge=1),
        limit: int = Query(20, ge=1, le=60),
        ids: str | None = Query(None, max_length=1200),
    ) -> dict[str, object]:
        if ids is not None:
            if q or tier or page != 1:
                raise HTTPException(422, "ids cannot be combined with q, tier, or page")
            try:
                appids = parse_ids(ids)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            items = repository.games_by_ids(appids)
            return {"items": items, "page": 1, "limit": len(appids), "total": len(items)}
        priority_appids: list[int] = []
        if not q.strip():
            try:
                priority_appids = await priority.get_appids()
            except PriorityUnavailable as error:
                LOG.warning("Catalog priority unavailable; using SQLite order: %s", error)
        items, total = repository.list_games(
            query=q,
            tier=tier,
            page=page,
            limit=limit,
            priority_appids=priority_appids,
        )
        return {"items": items, "page": page, "limit": limit, "total": total}

    @app.get("/api/games/trending", response_model=list[GameListItem])
    def trending_games() -> list[dict[str, object]]:
        try:
            appids = load_ordered_appids(settings.trending_path)
        except ValueError as error:
            raise HTTPException(503, str(error)) from error
        return repository.games_by_ids(appids)

    @app.get("/api/stats", response_model=StatsResponse)
    def stats(response: Response) -> dict[str, int]:
        actual_count, display_count = display_stats.counts(repository.actual_count())
        response.headers["Cache-Control"] = "public, max-age=180"
        return {"actual_count": actual_count, "display_count": display_count}

    @app.get("/api/games/{appid}", response_model=GameDetail)
    def game_detail(appid: int) -> dict[str, object]:
        if appid <= 0:
            raise HTTPException(422, "appid must be positive")
        result = repository.game_detail(appid)
        if not result:
            raise HTTPException(404, "Game not found")
        return result

    return app
