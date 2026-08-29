import argparse
import json
import os
import tempfile
from pathlib import Path

try:
    from web_catalog_builder.catalog_index import build_search_rows, compact_cover_url
except ModuleNotFoundError:
    from catalog_index import build_search_rows, compact_cover_url


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_GAMES_LIST = BASE_DIR / "games_list.json"
DEFAULT_INDEX = BASE_DIR / "output" / "search_index.json"


def load_json(path: Path, default=None):
    if default is not None and not path.exists():
        return default
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def normalize_game_appids(games: list) -> list[dict]:
    normalized = []
    for game in games:
        if not isinstance(game, dict):
            raise ValueError("games list entries must be JSON objects")
        raw_appid = game.get("appid")
        if isinstance(raw_appid, str) and raw_appid.strip().isdigit():
            game = {**game, "appid": int(raw_appid)}
        normalized.append(game)
    return normalized


def validate_rows(rows: list, expected_count: int) -> None:
    if len(rows) != expected_count:
        raise ValueError("search-index count does not match games-list count")
    if any(
        not isinstance(row, list)
        or len(row) != 4
        or not isinstance(row[0], int)
        or isinstance(row[0], bool)
        or not isinstance(row[1], str)
        or not row[1].strip()
        or row[2] not in (0, 1)
        or isinstance(row[2], bool)
        or not isinstance(row[3], str)
        for row in rows
    ):
        raise ValueError("search index contains an invalid four-field tuple")
    if len({row[0] for row in rows}) != len(rows):
        raise ValueError("search index contains duplicate AppIDs")


def validate_cover_migration(games: list[dict], old_rows: list, rows: list[list]) -> None:
    old_appids = {
        row[0]
        for row in old_rows
        if isinstance(row, list)
        and len(row) >= 4
        and isinstance(row[0], int)
        and not isinstance(row[0], bool)
    }
    generated_appids = {row[0] for row in rows}
    missing = sorted(old_appids - generated_appids)
    if missing:
        raise ValueError(f"existing AppID {missing[0]} disappeared")

    old_covers = {
        row[0]: compact_cover_url(row[3])
        for row in old_rows
        if isinstance(row, list)
        and len(row) >= 4
        and isinstance(row[0], int)
        and not isinstance(row[0], bool)
        and compact_cover_url(row[3])
    }
    explicit_cover_appids = {
        game["appid"]
        for game in games
        if compact_cover_url(game.get("cover_url"))
    }
    generated_covers = {row[0]: row[3] for row in rows}
    lost = [
        appid
        for appid in old_covers
        if appid not in explicit_cover_appids and not generated_covers.get(appid)
    ]
    if lost:
        raise ValueError(f"lost existing cover for AppID {lost[0]}")


def write_json_atomic(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            delete=False,
            dir=path.parent,
            prefix=path.name + ".",
            suffix=".tmp",
        ) as file:
            temporary_path = Path(file.name)
            json.dump(value, file, ensure_ascii=False, separators=(",", ":"))
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Build NexaPlay four-field search index.")
    parser.add_argument("--games-list", type=Path, default=DEFAULT_GAMES_LIST)
    parser.add_argument("--existing-index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--output", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


def build_index(
    games_list_path: Path,
    existing_index_path: Path,
    output_path: Path,
    check: bool = False,
) -> list[list]:
    games = load_json(games_list_path)
    old_rows = load_json(existing_index_path)
    if not isinstance(games, list):
        raise ValueError("games list root must be a JSON array")
    if not isinstance(old_rows, list):
        raise ValueError("existing index root must be a JSON array")

    games = normalize_game_appids(games)
    rows = build_search_rows(games, old_rows)
    validate_rows(rows, len(games))
    validate_cover_migration(games, old_rows, rows)
    if not check:
        write_json_atomic(output_path, rows)
    return rows


def main() -> None:
    args = parse_args()
    rows = build_index(
        args.games_list,
        args.existing_index,
        args.output,
        check=args.check,
    )
    message = f"Validated {len(rows)} unique games with four-field tuples"
    if args.check:
        print(message)
    else:
        print(f"{message}; wrote {args.output}")


if __name__ == "__main__":
    main()
