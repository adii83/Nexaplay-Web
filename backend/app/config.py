from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    catalog_db: Path
    manifest_url: str = "https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json"
    priority_url: str = "https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/main/appid_populer.json"
    priority_cache: Path = Path("data/priority_appids.json")
    priority_refresh_seconds: int = 300
    trending_path: Path = Path("../appid_trending.json")
    display_stats_path: Path = Path("data/display_stats.json")
    update_interval_seconds: int = 300
    network_timeout_seconds: float = 20.0
    background_updates: bool = True
    allowed_origins: tuple[str, ...] = (
        "https://nexaplayid.store",
        "https://www.nexaplayid.store",
    )
    development: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        database = os.environ.get("NEXAPLAY_CATALOG_DB", "data/catalog.sqlite")
        origins = os.environ.get(
            "NEXAPLAY_ALLOWED_ORIGINS",
            "https://nexaplayid.store,https://www.nexaplayid.store",
        )
        development = os.environ.get("NEXAPLAY_ENV", "production").lower() == "development"
        allowed = tuple(origin.strip() for origin in origins.split(",") if origin.strip())
        if development:
            allowed += ("http://localhost:8000", "http://127.0.0.1:8000")
        return cls(
            catalog_db=Path(database),
            manifest_url=os.environ.get(
                "NEXAPLAY_MANIFEST_URL",
                "https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json",
            ),
            priority_url=os.environ.get(
                "NEXAPLAY_PRIORITY_URL",
                "https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/main/appid_populer.json",
            ).strip(),
            priority_cache=Path(os.environ.get("NEXAPLAY_PRIORITY_CACHE", "data/priority_appids.json")),
            priority_refresh_seconds=max(30, int(os.environ.get("NEXAPLAY_PRIORITY_REFRESH_SECONDS", "300"))),
            trending_path=Path(os.environ.get("NEXAPLAY_TRENDING_PATH", "../appid_trending.json")),
            display_stats_path=Path(os.environ.get("NEXAPLAY_DISPLAY_STATS_PATH", "data/display_stats.json")),
            update_interval_seconds=max(60, int(os.environ.get("NEXAPLAY_UPDATE_INTERVAL_SECONDS", "300"))),
            network_timeout_seconds=max(1.0, float(os.environ.get("NEXAPLAY_NETWORK_TIMEOUT_SECONDS", "20"))),
            background_updates=os.environ.get("NEXAPLAY_BACKGROUND_UPDATES", "1") == "1",
            allowed_origins=allowed,
            development=development,
        )
