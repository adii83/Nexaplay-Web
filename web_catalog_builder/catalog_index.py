STEAM_ASSET_PREFIXES = (
    "https://shared.steamstatic.com/store_item_assets/steam/apps/",
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/",
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/",
)


def compact_cover_url(url: str) -> str:
    if not isinstance(url, str):
        return ""
    value = url.strip()
    if not value or value == "NO CONTENT":
        return ""
    for prefix in STEAM_ASSET_PREFIXES:
        if value.startswith(prefix):
            return value[len(prefix):]
    return value


def existing_cover_map(rows: list) -> dict[int, str]:
    covers = {}
    seen = set()
    for row in rows:
        if (
            not isinstance(row, list)
            or len(row) < 4
            or not isinstance(row[0], int)
            or isinstance(row[0], bool)
        ):
            continue
        appid = row[0]
        if appid in seen:
            raise ValueError(f"duplicate AppID: {appid}")
        seen.add(appid)
        if isinstance(row[3], str):
            covers[appid] = row[3]
    return covers


def build_search_rows(games: list[dict], old_rows: list) -> list[list]:
    old_covers = existing_cover_map(old_rows)
    seen = set()
    rows = []
    for game in games:
        raw_appid = game.get("appid")
        if not isinstance(raw_appid, int) or isinstance(raw_appid, bool) or raw_appid <= 0:
            raise ValueError(f"invalid AppID: {raw_appid!r}")
        appid = raw_appid
        title = game.get("title")
        if appid in seen:
            raise ValueError(f"duplicate AppID: {appid}")
        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"invalid title for AppID {appid}")
        seen.add(appid)
        premium = game.get("premium")
        if not isinstance(premium, bool) and not (
            isinstance(premium, int) and premium in (0, 1)
        ):
            raise ValueError(f"invalid premium value for AppID {appid}: {premium!r}")
        cover = compact_cover_url(game.get("cover_url"))
        if not cover:
            cover = compact_cover_url(old_covers.get(appid, ""))
        if not cover:
            cover = compact_cover_url(game.get("header"))
        rows.append([appid, title, 1 if premium else 0, cover])
    return rows
