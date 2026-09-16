from __future__ import annotations

import json

from .catalog_updater import CatalogUpdater
from .config import Settings
from .database import CatalogDatabase


def main() -> int:
    settings = Settings.from_env()
    database = CatalogDatabase(settings.catalog_db)
    database.validate()
    result = CatalogUpdater(
        database,
        settings.manifest_url,
        settings.network_timeout_seconds,
    ).check_and_apply()
    print(json.dumps(result.__dict__, separators=(",", ":")))
    return 0 if result.status in {"NoChange", "Applied", "LocalAhead"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
