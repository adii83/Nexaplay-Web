from __future__ import annotations

import json
import unicodedata
from typing import Any, Iterable

from .database import CatalogDatabase


def normalize_search(value: str) -> str:
    result: list[str] = []
    pending_space = False
    for character in unicodedata.normalize("NFD", value.strip()):
        if unicodedata.category(character) in {"Mn", "Mc", "Me"}:
            continue
        if character in {"'", "\u2018", "\u2019", "`", "\u00b4"}:
            continue
        if character.isalnum():
            if pending_space and result:
                result.append(" ")
            result.append(character.lower())
            pending_space = False
        else:
            pending_space = bool(result)
    return "".join(result)


class CatalogRepository:
    def __init__(self, database: CatalogDatabase):
        self.database = database
        with database.connect() as connection:
            has_overrides = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_runtime_overrides'"
            ).fetchone()
        self._effective_sql = self._build_effective_sql(bool(has_overrides))

    @staticmethod
    def _build_effective_sql(has_overrides: bool) -> str:
        if not has_overrides:
            return """
                WITH effective AS (
                    SELECT appid, name, normalized_name, library_capsule, genre, tier, pc_requirements
                    FROM games
                )
            """
        return """
            WITH effective AS (
                SELECT g.appid,
                       COALESCE(o.name, g.name) AS name,
                       COALESCE(o.normalized_name, g.normalized_name) AS normalized_name,
                       COALESCE(o.library_capsule, g.library_capsule) AS library_capsule,
                       COALESCE(o.genre, g.genre) AS genre,
                       COALESCE(o.tier, g.tier) AS tier,
                       g.pc_requirements AS pc_requirements
                FROM games g
                LEFT JOIN catalog_runtime_overrides o ON o.appid = g.appid
            )
        """

    @staticmethod
    def _list_item(row: Any) -> dict[str, Any]:
        return {
            "appid": row["appid"],
            "name": row["name"],
            "library_capsule": (row["library_capsule"] or "").strip(),
            "tier": row["tier"],
        }

    def list_games(
        self,
        *,
        query: str,
        tier: str | None,
        page: int,
        limit: int,
        priority_appids: Iterable[int] = (),
    ) -> tuple[list[dict[str, Any]], int]:
        clauses: list[str] = []
        parameters: list[Any] = []
        search = query.strip()
        if search:
            if search.isdecimal() and int(search) > 0:
                clauses.append("appid = ?")
                parameters.append(int(search))
            else:
                normalized = normalize_search(search)
                if not normalized:
                    return [], 0
                clauses.append("normalized_name LIKE ? ESCAPE '\\'")
                escaped = normalized.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                parameters.append(f"%{escaped}%")
        if tier:
            clauses.append("tier = ?")
            parameters.append(tier)
        priority = list(dict.fromkeys(priority_appids)) if not search else []
        if not search:
            clauses.append(
                "(LOWER(TRIM(library_capsule)) LIKE 'http://%' OR "
                "LOWER(TRIM(library_capsule)) LIKE 'https://%')"
            )
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        if priority:
            priority_order = "CASE appid " + " ".join(
                f"WHEN ? THEN {rank}" for rank in range(len(priority))
            ) + f" ELSE {len(priority)} END, "
        else:
            priority_order = ""

        with self.database.connect() as connection:
            total = connection.execute(
                f"{self._effective_sql} SELECT COUNT(*) FROM effective {where}",
                parameters,
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                {self._effective_sql}
                SELECT appid, name, library_capsule, tier
                FROM effective
                {where}
                ORDER BY {priority_order}normalized_name, appid
                LIMIT ? OFFSET ?
                """,
                [*parameters, *priority, limit, (page - 1) * limit],
            ).fetchall()
        return [self._list_item(row) for row in rows], total

    def actual_count(self) -> int:
        with self.database.connect() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM games").fetchone()[0])

    def games_by_ids(self, appids: Iterable[int]) -> list[dict[str, Any]]:
        ordered = list(appids)
        if not ordered:
            return []
        placeholders = ",".join("?" for _ in ordered)
        with self.database.connect() as connection:
            rows = connection.execute(
                f"""
                {self._effective_sql}
                SELECT appid, name, library_capsule, tier
                FROM effective
                WHERE appid IN ({placeholders})
                """,
                ordered,
            ).fetchall()
        by_id = {row["appid"]: self._list_item(row) for row in rows}
        return [by_id[appid] for appid in ordered if appid in by_id]

    def game_detail(self, appid: int) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                f"""
                {self._effective_sql}
                SELECT appid, name, library_capsule, genre, tier, pc_requirements
                FROM effective
                WHERE appid = ?
                """,
                (appid,),
            ).fetchone()
        if not row:
            return None
        return {
            **self._list_item(row),
            "genre": self._parse_genre(row["genre"]),
            "pc_requirements": self._parse_requirements(row["pc_requirements"]),
        }

    @staticmethod
    def _parse_genre(value: str) -> list[str]:
        try:
            parsed = json.loads(value or "[]")
        except (TypeError, json.JSONDecodeError):
            return []
        if not isinstance(parsed, list):
            return []
        return [item.strip() for item in parsed if isinstance(item, str) and item.strip()]

    @staticmethod
    def _parse_requirements(value: str) -> dict[str, str]:
        try:
            parsed = json.loads(value or "{}")
        except (TypeError, json.JSONDecodeError):
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        return {
            "minimum": parsed.get("minimum", "").strip() if isinstance(parsed.get("minimum"), str) else "",
            "recommended": parsed.get("recommended", "").strip() if isinstance(parsed.get("recommended"), str) else "",
        }
