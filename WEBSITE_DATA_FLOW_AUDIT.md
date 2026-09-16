# NexaPlay Website Data Flow Audit Before SQLite Migration

> [!NOTE]
> Sections 1-22 are a historical pre-migration snapshot and intentionally mention removed systems. Sections 23 onward describe the current SQLite/FastAPI architecture. For active operations, use [`README.md`](README.md) and [`Tutorial.md`](Tutorial.md).

Audit date: 2026-09-16 (Asia/Bangkok)

Historical scope for sections 1-22: analysis only. No migration, backend, UI, deployment, or catalog source was changed during that audit.

## 1. Executive Summary

The website is a static GitHub Pages site built with plain HTML, CSS, and browser JavaScript. It has no package manager, application build step, framework router, server-side runtime, or top-level deployment workflow in this repository.

Current catalog startup downloads the complete `web_catalog_builder/output/search_index.json` into every browser. The local file is 12,700,100 bytes and contains 146,851 games. A live GitHub Pages request returned 12,700,095 raw bytes and 4,774,194 bytes with gzip on the audit date. Browser search, tier filtering, priority ordering, and load-more pagination all operate on this full in-memory array.

Current game detail is not stored in the search index. Clicking a card fetches one complete R2 object from `https://meta.nexaplaymetadata.online/Metadata/{appid}.json`, then browser code merges sparse `overrides.json` values and renders title, tier, cover, publisher, genres, and PC requirements. There is no detail cache; `cache: 'no-cache'` causes repeated opens to revalidate/refetch.

Existing runtime `catalog.sqlite` is available at `C:\Users\ADMIN\AppData\Local\NexaPlay\Data\catalog.sqlite`. It is schema version 1, catalog version 4, 170,987,520 bytes, and contains 163,262 games plus 165 runtime override rows. Its manifest and patch protocol is live and usable by a VPS backend without modification.

SQLite compatibility is **PARTIAL**, not complete parity:

- Core list fields exist: AppID, name, cover, tier, genres, price, protection, and PC requirements.
- Publisher is displayed by the current detail modal but is absent from the SQLite schema and patch rows.
- Current website and SQLite membership differ: 92 website AppIDs are missing from SQLite, while SQLite has 16,503 AppIDs not exposed by the website.
- Among 146,759 common AppIDs, exact effective-value comparisons found 20,710 title differences, 8,687 tier differences, and 16,216 cover differences. SQLite has no effective cover for 7,252 common website games.
- The current website's curated priority and popular order are external lists, not SQLite fields.

Therefore the next task must not switch the frontend directly to an unfiltered SQLite query. First reconcile membership and parity policy through the existing Catalog Builder / Publisher pipeline, and decide how publisher data will be supplied. No second publishing workflow is needed.

## 2. Project Structure

### Runtime architecture

| Area | Actual implementation |
|---|---|
| Framework | None; plain HTML/CSS/JavaScript |
| Pages | `index.html`, `showcase.html` |
| Routing | Static pages plus hash anchors; no SPA router |
| Shared browser code | `js/app.js`, `js/data.js` |
| Catalog browser code | `js/index.js`, `js/catalog-data.js` |
| Showcase code | `js/showcase.js` |
| Styles | `css/base.css`, `css/components.css`, `css/index.css`, `css/showcase.css` |
| Package manager | None; no `package.json` or lockfile |
| Build system | None for site runtime |
| External libraries | GSAP 3.12.5 and ScrollTrigger from cdnjs; Google Fonts |
| Hosting | GitHub Pages, custom domain from `CNAME` |
| Custom domain | `nexaplayid.store` |
| Git repository | `https://github.com/adii83/Nexaplay-Web.git`, branch `main` |

### Catalog-related files

| File/directory | Current role |
|---|---|
| `appid.json` | 245 curated priority AppIDs for catalog ordering |
| `appid_populer.json` | 10 curated popular AppIDs for trending cards |
| `web_catalog_builder/games_list.json` | Durable website admission/master list; 146,851 rows, 27,974,168 bytes |
| `web_catalog_builder/output/search_index.json` | Browser startup catalog; four-field tuples, 12,700,100 bytes |
| `web_catalog_builder/output/search_index.json.gz` | Precompressed artifact, 2,835,380 bytes; frontend never requests it |
| `web_catalog_builder/output/overrides.json` | Browser-readable sparse override projection; 10 AppIDs, 2,488 bytes |
| `web_catalog_builder/output/r2_manifest.json` | R2 object ETag/Last-Modified sync state; 163,371 objects, 17,123,208 bytes |
| `web_catalog_builder/build_index.py` | Builds and validates the four-field search index |
| `web_catalog_builder/catalog_index.py` | Compacts Steam URLs and resolves search-index cover fallback |
| `web_catalog_builder/build_web_catalog.py` | Legacy full catalog/chunk generator |
| `web_catalog_builder/cache/nexaplay_override.json` | Cached override input for legacy builder |
| `web_catalog_builder/output/catalog.json` | Legacy rollback-only full catalog; 151,521,828 bytes |
| `web_catalog_builder/output/chunks/` | 1,469 legacy rollback-only detail chunks; 151,526,232 bytes total |
| `web_catalog_builder/output/resume_state.json*` | Legacy builder checkpoint state |
| `integrations/nexaplay-metadata-override/` | Cross-repository catalog sync bundle and tests |
| `tests/catalog-data.test.js` | Browser adapter unit tests using Node built-in test runner |
| `web_catalog_builder/tests/test_catalog_index.py` | Search-index builder tests |

`scripts/` is empty. No top-level `.github/workflows`, `.env`, package manifest, or frontend build configuration exists.

### Page entry points

`index.html` loads scripts in this order:

1. GSAP and ScrollTrigger from cdnjs.
2. `js/data.js`.
3. `js/app.js`.
4. `js/catalog-data.js`.
5. `js/index.js`.

`showcase.html` loads GSAP, `js/data.js`, `js/app.js`, and `js/showcase.js`. It does not load catalog data.

## 3. Current Data Sources

| Source | File / URL | Called by | When called | Fields used | Cache/state | Blocking | Current purpose |
|---|---|---|---|---|---|---|---|
| Priority list | `appid.json` | `loadCatalogData()` -> `prioritizeCatalogItems()` | Initial page load | AppID only | In-memory page lifetime | Yes; failure rejects startup | Put curated games first |
| Popular list | `appid_populer.json` | `loadCatalogData()` -> `renderTrendingGames()` | Initial page load | AppID only, first 10 | `window.popularAppids` | Request is awaited, but failure becomes `[]` | Trending rank/order |
| Browser catalog | `web_catalog_builder/output/search_index.json` | `loadCatalogData()` | Initial page load | `[appid,title,premium_flag,cover_data]` | `catalogData`, `orderedCatalogData` | Yes; failure rejects startup | Cards, count, hero, trending, search, tier filter |
| Browser overrides | `web_catalog_builder/output/overrides.json` | `loadCatalogData()` -> `openCatalogModal()` | Initial page load, applied on detail open | Sparse `catalog` and `detail` values | `catalogOverrides` | Request awaited; failure falls back to `{}` | Override R2 detail fields |
| R2 metadata | `https://meta.nexaplaymetadata.online/Metadata/{appid}.json` | `fetchCatalogMetadata()` -> `openCatalogModal()` | Every card open | `name`, selected assets, publishers, genres, PC requirements; developers are transformed but not rendered | No application cache; `cache: no-cache` | Yes; modal waits up to 15 seconds | Game detail |
| Website master | `web_catalog_builder/games_list.json` | `build_index.py`, sync workflow | Build/sync time only | `appid`, `title`, `premium`, `cover_url` or legacy `header` | Git repository | Not browser runtime | Website membership and stable tier |
| R2 object listing state | `web_catalog_builder/output/r2_manifest.json` | `sync_nexaplay_web.py` | Scheduled/push/manual sync | AppID, ETag, LastModified | Persistent Git file; no TTL | Build-time only | Detect changed R2 objects |
| Source overrides | External `nexaplay_override.json` | Sync script and legacy builder | Sync/build time | Many allowed catalog/detail fields | Projected into `overrides.json` | Build-time only | Sparse corrections |
| New-game admission | External `new_games.json` | `sync_nexaplay_web.py` | Sync time | AppID array | Source repository | Build-time only | Explicitly admit new website games |
| Local metadata directory | `D:\My Project\___Metadata Nexaplay Cloudfare R2\Metadata\{appid}.json` | `build_web_catalog.py` | Legacy manual build | Cover, publisher, genres, requirements | Local disk | Build-time only | Generate legacy full catalog/chunks |
| Raw GitHub override | `https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/refs/heads/main/nexaplay_override.json` | `build_web_catalog.py` | Legacy build cache miss/force | Override cover fields | `web_catalog_builder/cache/nexaplay_override.json` | Build-time only | Legacy enrichment |
| Static demo data | `js/data.js` `GAMES_DATA` | No caller found | Never | Demo IDs/titles/categories | JavaScript constant | No | Dead catalog sample data |
| Static publisher names | `js/data.js` `PUBLISHERS` | `initMarquee()` | Page initialization | Publisher name strings | JavaScript constant | No | Decorative marquee, not catalog data |

Important distinctions:

- `web_catalog_builder/output/r2_manifest.json` is website sync state, not the Desktop `catalog_manifest.json` patch protocol.
- `D:\My Project\NEXAPLAY\Data\__nexaplay-metadata\catalog_manifest.json` is a separate legacy source-file manifest for files such as `steam_data.json`; it is not the new SQLite patch manifest.
- Current browser code does not request `catalog.json`, chunk files, `games_list.json`, `r2_manifest.json`, `resume_state.json`, or `search_index.json.gz`.

## 4. Current Network Requests

### Browser requests

| Request | Initiator | Behavior |
|---|---|---|
| `appid.json` | `loadCatalogData()` | Same-origin JSON, startup-blocking |
| `web_catalog_builder/output/search_index.json` | `loadCatalogData()` | Same-origin full catalog, startup-blocking |
| `appid_populer.json` | `loadCatalogData()` | Same-origin text then repaired/parses trailing commas; failure tolerated |
| `web_catalog_builder/output/overrides.json` | `loadCatalogData()` | Same-origin JSON; failure tolerated |
| `https://meta.nexaplaymetadata.online/Metadata/{appid}.json` | `fetchCatalogMetadata()` | Cross-origin R2 GET per card open, 15-second abort timeout, `cache: no-cache` |
| Steam/SteamGridDB image URLs | Browser image loader | Cards/modal lazy; hero backgrounds eager after catalog load |
| Google Fonts | HTML links and duplicate `@import` in `css/base.css` | Page typography |
| cdnjs GSAP scripts | HTML script tags | Required before local scripts execute |

Live checks on 2026-09-16:

- GitHub Pages served `search_index.json` with `Cache-Control: max-age=600`.
- With `Accept-Encoding: gzip`, transfer size was 4,774,194 bytes.
- R2 metadata returned `Access-Control-Allow-Origin: https://nexaplayid.store` and exposed `ETag`.

### Build/sync requests

| Request/source | Caller | Purpose |
|---|---|---|
| Cloudflare R2 S3 endpoint `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` | GitHub Action AWS CLI | List `Metadata/` objects |
| `https://meta.nexaplaymetadata.online/Metadata/{appid}.json` | `sync_nexaplay_web.py` | Fetch new/changed/override-affected metadata |
| `adii83/Nexaplay-Web` Git checkout | GitHub Action | Update four generated website files |
| Raw GitHub override URL | Legacy builder | Download override input |

No `axios`, `XMLHttpRequest`, jQuery AJAX, WebSocket, or GraphQL request exists.

## 5. Home Data Flow

### Startup sequence

```text
DOMContentLoaded
  -> requestAnimationFrame callback in js/index.js
  -> initHeroAnimation()
  -> initHeroCapsules()
  -> initCatalogControls()
  -> initMarquee()
  -> await loadCatalogData()
       -> Promise.all(priority, full search index, popular list, overrides)
       -> normalizeCatalogItem() for all 146,851 tuples
       -> prioritizeCatalogItems()
       -> populate catalogData / orderedCatalogData / catalogOverrides
  -> updateCatalogCounter()
  -> renderTrendingGames()
  -> updateHeroCapsulesImages()
  -> renderCatalog(true)
  -> hide global loader
```

### Hero

`initHeroCapsules()` creates six placeholders from hard-coded AppIDs. After the full catalog arrives, `updateHeroCapsulesImages()` builds an AppID map over the complete dataset and replaces matching capsule backgrounds with catalog cover URLs.

### Trending

`renderTrendingGames()` builds another AppID map over the complete dataset, maps the first 10 `appid_populer.json` entries, adds ranks, and renders interactive cards. Clicking a trending card uses the same detail flow as catalog cards.

No separate Home API, route, or data model exists.

## 6. Catalog/Games Data Flow

```text
index.html #catalog
  -> loadCatalogData()
  -> fetch search_index.json in full
  -> NexaCatalogData.normalizeCatalogItem()
  -> prioritizeCatalogItems(appid.json, catalogItems)
  -> getFilteredGames()
  -> renderCatalog()
  -> first 20 matching rows rendered
  -> Load More increases visible count by 20
```

`search_index.json` tuple contract:

```text
[appid, title, premium_flag, cover_data]
```

`cover_data` is usually a Steam-relative path. `resolveCoverUrl()` prepends:

```text
https://shared.steamstatic.com/store_item_assets/steam/apps/
```

Current index statistics:

- 146,851 unique rows.
- 18,341 Premium and 128,510 Standard.
- Zero empty cover values.
- 146,849 relative Steam cover paths.
- Two absolute `cdn2.steamgriddb.com` covers.

There are no separate Premium, Standard, genre, protection, or search pages. All surfaces are sections on `index.html` and share one array.

## 7. Search/Filter/Sort

| Feature | Current implementation |
|---|---|
| Search location | Frontend-only over the full in-memory dataset |
| Search fields | Normalized title substring OR raw AppID substring |
| AppID behavior | Substring match, not exact numeric match |
| Normalization | Lowercase; remove quotes/trademark symbols; replace non-alphanumeric characters with spaces; collapse spaces |
| Debounce | 300 ms for catalog and navbar search |
| Minimum characters | None; one character scans all rows |
| Tier filter | `all`, `Premium`, `Standard`; boolean comparison against tuple flag |
| Genre filter | Not implemented |
| Protection/Denuvo filter | Not implemented |
| Price filter | Not implemented |
| Sort control | Not implemented |
| Default ordering | 245 priority AppIDs first, then original `search_index.json` order |
| Random ordering | None |
| Pagination | Client display pagination only; full catalog is already downloaded |
| Page size | 20, adjusted downward to fill complete responsive grid rows |
| URL query state | None |
| Back/forward state | None |

Complexity and repeated work:

- Every search/filter starts with a copy of `orderedCatalogData`: O(N) memory and time.
- Title normalization runs again for every game on every debounced search: O(N * title length).
- Filtering scans all 146,851 rows even though at most the first visible batch is rendered.
- `getCatalogItemByAppid()` performs a linear `.find()` on card click.
- Catalog order is not alphabetical or random; it depends on the durable `games_list.json`/index order after the priority block.

## 8. Game Detail Flow

```text
card click or Enter/Space
  -> delegated event handler reads data-game-id
  -> openCatalogModal(appid, card)
  -> getCatalogItemByAppid(appid)
  -> await fetchCatalogMetadata(appid)
       -> GET R2 Metadata/{appid}.json
       -> 15-second AbortController timeout
       -> cache: no-cache
  -> NexaCatalogData.isUsableMetadata()
  -> NexaCatalogData.extractModalData()
  -> NexaCatalogData.mergeModalData(R2, override, search-index fallback)
  -> create/populate modal
  -> render image, tier, publisher, genres, requirements
```

There is no route change, query parameter, detail page, or shareable detail URL. AppID exists only in DOM attributes and JavaScript state.

Fields rendered by the modal:

- `appid`.
- `title`.
- Premium/Standard status.
- `cover_url`.
- `publishers` joined with commas.
- `genres` as chips.
- `specification.minimum`.
- `specification.recommended`.

Fields extracted but not rendered:

- `developers`.

Failure behavior:

- The modal does not open until the R2 request succeeds or fails.
- On failure, the card's index title/tier/cover remain available.
- Publisher becomes `Detail belum tersedia`.
- Genres are hidden.
- Specification displays a retry instruction.
- A second open performs another network request.

## 9. Artwork Flow

### List/search artwork

Build-time source order in `sync_nexaplay_web.py`:

```text
override catalog.library_capsule
  -> override catalog.library_capsule_2x
  -> override catalog.header
  -> R2 assets.library_capsule[0].url
  -> R2 assets.library_capsule_2x[0].url
  -> R2 assets.header[0].url
  -> existing cover_url/header
```

`catalog_index.py` then stores a compact relative path for recognized Steam CDN prefixes. Browser `resolveCoverUrl()` expands relative paths to `shared.steamstatic.com`.

### Detail artwork

Browser merge order:

```text
override catalog.library_capsule
  -> override catalog.library_capsule_2x
  -> override catalog.header
  -> R2 library_capsule
  -> R2 library_capsule_2x
  -> R2 header
  -> search-index cover
```

### Loading and fallback

- Card images use `loading="lazy"` and `decoding="async"`.
- Modal image also uses lazy loading and async decoding.
- Hero backgrounds are CSS background images and load eagerly after catalog startup.
- Missing or invalid card cover falls back to a deterministic monochrome gradient.
- Missing modal cover falls back to a gradient with `NO CONTENT`.
- URLs are restricted to HTTP/HTTPS by `safeHttpUrl()`.
- No explicit `error` handler replaces an image that returns HTTP failure after URL validation.
- Browser/CDN caching is implicit; no application image cache exists.

Current domains used by catalog artwork include:

- `shared.steamstatic.com` after relative-path expansion.
- `shared.fastly.steamstatic.com` in source/overrides.
- `shared.akamai.steamstatic.com` is recognized by the builder.
- `cdn2.steamgriddb.com` for two current index rows and sparse overrides.

## 10. Field Usage Matrix

| Field / effective concept | Current source | Where used | Card | Detail | Search | Filter | Sort | SQLite field | Concern |
|---|---|---|---|---|---|---|---|---|---|
| `appid` | Search index tuple | DOM identity, lookup, display, R2 URL | Yes | Yes | Yes | No | Priority only | `games.appid` | 92 website IDs absent from SQLite |
| `title` / `name` | Search index; R2/override for modal | Card/modal text | Yes | Yes | Yes | No | Existing file order | `games.name` | 20,710 exact title differences among common IDs |
| `normalized_name` | Generated at search time in browser | Search comparison | No | No | Yes | No | No | `games.normalized_name` | API should use stored normalized value |
| `premium` | Search index flag | Badge/status and tier filter | Yes | Yes | No | Yes | No | `games.tier` | 8,687 effective tier differences |
| `cover_url` | Search index/R2/override | Card, hero, modal | Yes | Yes | No | No | No | `games.library_capsule` | 16,216 differences; 7,252 common rows lack effective SQLite cover |
| `publishers` | R2 `store_data.publishers`; override | Modal publisher line | No | Yes | No | No | No | Missing | Required parity gap |
| `developers` | R2/override | Extracted and merged only | No | No | No | No | No | Missing | Currently unused; do not add for website parity |
| `genres` | R2 `store_data.genres[].description`; override | Modal chips | No | Yes | No | No | No | `games.genre` JSON | 4,600 common rows have empty effective SQLite genre |
| `pc_requirements.minimum` | R2/override | Modal spec | No | Yes | No | No | No | `games.pc_requirements` JSON | 4,570 common rows have neither minimum nor recommended text |
| `pc_requirements.recommended` | R2/override | Modal spec | No | Yes | No | No | No | `games.pc_requirements` JSON | Same gap as above |
| `price_normalized` | Override/build logic | New-game Premium classification only | No | No | No | No | No | `games.price_normalized` | Not needed in initial website API response |
| `price_display` | Override projection | Not consumed by frontend | No | No | No | No | No | `games.price_display` | Retire browser projection use |
| `protection` | Override projection | Not consumed by frontend | No | No | No | No | No | `games.protection` | No current Denuvo UI |
| `genre` override | Sparse override | Modal genres | No | Yes | No | No | No | Effective `genre` | Browser merge becomes unnecessary when DB is authoritative |
| `library_capsule_2x` | R2/override | Cover fallback | Yes | Yes | No | No | No | No separate column | Effective `library_capsule` is sufficient only after coverage reconciliation |
| `header` | Master/R2/override | Cover fallback | Yes | Yes | No | No | No | No separate column | Same as above |
| `library_hero_2x` | Override projection | Not consumed | No | No | No | No | No | Missing | Do not send/add for current UI |
| `screenshots`, `movies` | Allowed override/R2 fields | Not consumed | No | No | No | No | No | Missing | Not required |
| Descriptions/release/support fields | Allowed override/R2 fields | Not consumed | No | No | No | No | No | Mostly missing | Not required |
| Priority rank | `appid.json` array position | Default catalog order | Indirect | No | No | No | Yes | Missing | Keep as presentation configuration or model explicitly |
| Popular rank | `appid_populer.json` array position | Trending cards | Yes | No | No | No | Yes | Missing | Keep curated list or serve through `ids` query |

`catalog.sqlite` should not be expanded for developers, screenshots, movies, descriptions, or other currently unused R2 fields. Publisher is the only missing field required by the current visible detail UI.

## 11. Override Logic

### Build-time list merge

`integrations/nexaplay-metadata-override/scripts/sync_nexaplay_web.py` resolves:

- Title: override `catalog.title` -> R2 `name` -> existing website title.
- Cover: override capsule/header fields -> R2 capsule/header assets -> existing website cover/header.
- Premium on first admission: free is Standard; otherwise override normalized price, then R2 initial price conversion, threshold Rp135,000.
- Existing games retain their current Premium/Standard classification even when R2 price changes.

### Browser detail merge

`js/catalog-data.js` resolves:

- Title: override -> R2 -> search index.
- Cover: override -> R2 -> search index.
- Developers/publishers: detail override -> catalog plural -> catalog singular -> R2.
- Genres: catalog override -> R2.
- Requirements: detail override -> R2.
- Tier: always search-index `premium`; R2/override does not change it in the modal.

### Retire candidates

When the backend queries effective SQLite values, browser-side base + override merging for title, cover, tier, genre, price, protection, and PC requirements is redundant and should be retired. Do not retire it until publisher and artwork/membership parity are resolved.

Projected override fields currently unused by the frontend include price, protection, hero art, developers, descriptions, screenshots, movies, release data, support data, and store price details.

## 12. Cache/Local State

| Key/state | Value | TTL | Invalidation | Used by |
|---|---|---|---|---|
| `catalogData` | 146,851 normalized games | Page lifetime | Reload | Cards, trending, hero, detail fallback |
| `orderedCatalogData` | Priority-reordered full array | Page lifetime | Reload | Search/filter/render |
| `catalogOverrides` | Sparse override map | Page lifetime | Reload | Detail merge |
| `window.popularAppids` | First 10 popular AppIDs | Page lifetime | Reload | Trending |
| Browser HTTP cache for search index | GitHub Pages response | Current live max-age 600 seconds | HTTP cache rules | Startup fetch |
| R2 detail HTTP cache | Public metadata object | Explicit `no-cache`; revalidation expected | Every open/revalidation | Detail modal |
| Browser image cache | Steam/SteamGridDB responses | Remote header-defined | Browser/CDN rules | Artwork |
| `r2_manifest.json` | 163,371 object ETags/timestamps | No TTL | Sync listing comparison | GitHub Action synchronizer |
| `cache/nexaplay_override.json` | Legacy downloaded override | No TTL | `--force-override` or deletion | Legacy builder |
| `resume_state.json*` | Legacy build checkpoints | Until build completion/manual cleanup | Builder flow | Legacy builder |

No `localStorage`, `sessionStorage`, IndexedDB, Service Worker, Cache API, or application detail cache exists.

Future API + SQLite makes the browser full-catalog state, `overrides.json`, R2 detail state, and website R2 ETag manifest unnecessary. Normal browser HTTP caching for API and images remains useful.

## 13. Performance Findings

1. **Full catalog download is the main cost.** Every visit downloads/parses 146,851 rows before cards, trending, hero images, and the global loader complete. Live gzip transfer was about 4.77 MB; decoded JSON is about 12.7 MB before JavaScript object overhead.
2. **Client pagination does not reduce data transfer.** Only 20 cards render initially, but all rows are already downloaded and normalized.
3. **Repeated full scans.** Priority processing, filtering, title normalization, trending map creation, hero map creation, and detail lookup repeatedly traverse large arrays.
4. **Repeated detail requests.** No AppID detail cache exists; `cache: no-cache` causes repeated metadata validation/download.
5. **Modal waits on network.** No immediate loading modal appears; a slow R2 request delays feedback for up to 15 seconds.
6. **Oversized full detail objects.** R2 returns complete metadata, while the UI uses only title, selected cover, publisher, genres, and PC requirements.
7. **Large duplicate repository artifacts.** `catalog.json`, 1,469 chunks, `games_list.json`, search index, gzip copy, R2 manifest, and resume files consume over 360 MB locally. Most are not browser runtime dependencies.
8. **Unused precompressed artifact.** `search_index.json.gz` exists but code requests `.json`; live GitHub Pages applies its own gzip instead.
9. **No current N+1 list pattern.** Startup uses four parallel requests, not one request per game. Detail is one request per user-opened game, which becomes repeated only across opens.
10. **Image loading is mostly controlled.** Cards/modal are lazy; six hero backgrounds are eager. All current website index rows have a cover value.

## 14. GitHub Pages Deployment

- `CNAME` contains `nexaplayid.store`.
- Git remote is `adii83/Nexaplay-Web` and current branch is `main`.
- Repository contains no top-level Pages workflow or build configuration.
- Site paths are relative (`js/...`, `css/...`, `./web_catalog_builder/...`), compatible with custom-domain root hosting.
- Detail metadata is cross-origin and depends on R2 CORS. Production CORS currently allows `https://nexaplayid.store`.
- There is no server-side code in the website repository.
- There is no rewrite/fallback routing requirement because detail uses a modal, not client-side routes.

Future GitHub Pages constraints:

- Frontend must call an absolute HTTPS origin such as `https://api.nexaplayid.store`.
- API must allow the production origin, expected optional `www` origin if used, and development origins only where explicitly needed.
- API failure must not expose private credentials or raw database paths.
- Existing static navigation, CNAME, hash anchors, and showcase page can remain unchanged.
- If a future detail URL is added, GitHub Pages fallback behavior becomes a separate routing requirement; current UI does not require it.

## 15. Security Findings

### Confirmed

- No frontend API key, bearer token, password, service-role key, or private credential was found.
- Workflow files reference GitHub Secrets by name only: R2 access key, R2 secret, R2 account/bucket, and `NEXAPLAY_WEB_TOKEN`.
- Documentation scopes `NEXAPLAY_WEB_TOKEN` to `adii83/Nexaplay-Web` with Contents read/write.
- R2 metadata is intentionally public to the production browser origin.
- Browser validates image protocols as HTTP/HTTPS.
- Card titles are escaped before HTML template insertion.
- Requirement HTML is parsed and rendered as text label/value nodes rather than inserted directly as active HTML.

### Risks/requirements

- Future frontend must receive no SQLite path, R2 write credential, GitHub token, or private backend secret.
- Nginx/API CORS must be explicit; do not use credentials-enabled wildcard CORS.
- API input must validate AppID, query length, page, limit, tier, and `ids` count.
- Public API needs rate limiting and bounded pagination because the catalog is large.
- GSAP scripts are version-pinned but have no Subresource Integrity attribute. This is a general frontend supply-chain risk, not a catalog migration blocker.

No sensitive literal value was found, so no secret is reproduced in this report.

## 16. Existing catalog.sqlite Compatibility

### Actual runtime database

Path audited:

```text
C:\Users\ADMIN\AppData\Local\NexaPlay\Data\catalog.sqlite
```

State:

- Size: 170,987,520 bytes.
- Schema version: 1.
- Catalog version: 4.
- Game rows: 163,262.
- Runtime override rows: 165.
- Metadata includes `premium_threshold=135000`, `usd_to_idr=17500`, and build timestamp.

Bundled seed also exists at:

```text
D:\My Project\NEXAPLAY\Apps\NexaPlay\NexaPlay\data\catalog\catalog_seed.sqlite
```

The bundled seed is catalog version 2; the runtime DB has applied live patches through version 4.

### Tables

`games`:

| Column | Type | Notes |
|---|---|---|
| `appid` | INTEGER PK | Positive Steam AppID |
| `name` | TEXT | Display name |
| `normalized_name` | TEXT | Search value |
| `library_capsule` | TEXT nullable | Effective list artwork candidate |
| `genre` | TEXT | JSON array |
| `price_normalized` | INTEGER | IDR numeric value |
| `price_display` | TEXT | Display string |
| `protection` | INTEGER | Boolean check 0/1 |
| `tier` | TEXT | `standard` or `premium` |
| `pc_requirements` | TEXT | JSON object with minimum/recommended |

`catalog_meta` stores key/value metadata including `catalog_version`.

`catalog_runtime_overrides` is created in the runtime DB, not bundled seed. In the Desktop behavior audited at that time, it could override name, normalized name, capsule, genre, price, protection, and tier. Current non-null override counts were: 164 protection, 7 capsule, 1 price, 1 price display, and no title/genre/tier override. PC requirements were never runtime-overridden. This is historical Desktop context; the current Web API ignores this table. See Section 23.

Indexes:

- `idx_games_normalized_name`.
- `idx_games_price`.
- `idx_games_protection`.
- `idx_games_tier`.
- Primary-key indexes for AppID and meta key.

### Feature compatibility

| Website feature | Result | Reason |
|---|---|---|
| Card AppID/title/tier | PARTIAL | Columns exist, but membership/title/tier parity differs materially |
| Card artwork | PARTIAL | Column exists; 7,252 common website rows currently have no effective SQLite cover |
| Search by title/AppID | MATCH | Indexed normalized name and AppID query support exist; current AppID substring behavior would change unless reproduced |
| Premium/Standard filter | MATCH structurally | `tier` and index exist; actual values differ for 8,687 common games |
| Pagination | MATCH | Repository supports limit/offset and total count |
| Current default priority order | MISSING | 245-item priority list is outside SQLite |
| Trending rank | MISSING | 10-item popular list is outside SQLite |
| Publisher detail | MISSING | No publisher column or patch field |
| Genre detail | PARTIAL | Column exists; 4,600 common rows are empty |
| PC requirements | PARTIAL | Column exists; 4,570 common rows have no minimum/recommended content |
| Protection/Denuvo | MATCH but unused | Column/index exist; website has no current UI |
| Price | MATCH but unused | Columns/index exist; website has no current UI |

### Dataset parity

| Comparison | Count |
|---|---:|
| Website games | 146,851 |
| SQLite games | 163,262 |
| Common AppIDs | 146,759 |
| Website AppIDs absent from SQLite | 92 |
| SQLite AppIDs absent from website | 16,503 |
| Exact title differences among common IDs | 20,710 |
| Effective tier differences among common IDs | 8,687 |
| Effective cover differences among common IDs | 16,216 |

Eight curated priority AppIDs are absent from SQLite. All 10 popular AppIDs are present.

Conclusion: existing SQLite can become the core website source, but it cannot replace current website data completely without resolving publisher data, artwork coverage, membership policy, curated ordering, and value parity through the existing catalog pipeline.

## 17. Existing Manifest/Patch Compatibility

### Live manifest

URL:

```text
https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json
```

Live state on 2026-09-16:

- `schema_version`: 1.
- `latest_version`: 4.
- `minimum_supported_version`: 2.
- Patches: `patches/3.json` and `patches/4.json`.
- Patch 3: 2,056 bytes, transition 2 -> 3.
- Patch 4: 2,065 bytes, transition 3 -> 4.

Manifest shape:

```json
{
  "schema_version": 1,
  "latest_version": 4,
  "minimum_supported_version": 2,
  "generated_at": "...",
  "patches": [
    {
      "version": 3,
      "file": "patches/3.json",
      "size": 2056,
      "sha256": "..."
    }
  ]
}
```

Desktop ignores unknown `generated_at` safely. It requires schema 1, valid version bounds, unique patch versions, relative same-origin patch paths, SHA-256, and declared byte size.

### Patch shape

```json
{
  "schema_version": 1,
  "from_version": 2,
  "to_version": 3,
  "generated_at": "...",
  "upsert": [
    {
      "appid": 2215200,
      "name": "...",
      "normalized_name": "...",
      "library_capsule": "https://...",
      "genre": ["Action", "Adventure"],
      "price_normalized": 1149000,
      "price_display": "Rp 1149000",
      "protection": false,
      "tier": "premium",
      "pc_requirements": {
        "minimum": "...",
        "recommended": "..."
      }
    }
  ],
  "delete": []
}
```

Validation and application rules from Desktop:

1. Download manifest over HTTPS.
2. If local version equals latest: no change.
3. If local version is ahead: keep local DB and report `LocalAhead`.
4. If local version is below `minimum_supported_version`: do not fetch a full DB; report unsupported baseline and require a newer seeded release.
5. Resolve every version from local+1 through latest; a missing version fails the chain.
6. Download each relative patch from the manifest origin.
7. Validate byte size and SHA-256 before parsing.
8. Require patch schema 1, `from_version > 0`, and `to_version = from_version + 1`.
9. Require unique positive upsert AppIDs, nonempty name/normalized name, genre array, PC requirements object, and valid tier.
10. Require unique positive deletes and no AppID conflict between upsert and delete.
11. Apply each patch in one SQLite transaction.
12. UPSERT all game columns with `ON CONFLICT(appid) DO UPDATE`.
13. DELETE requested AppIDs.
14. Update `catalog_meta.catalog_version` inside the same transaction.
15. Commit one patch before downloading/applying the next.

Atomicity is per patch, not for the whole multi-patch chain. If patch 4 fails after patch 3 commits, version 3 remains valid and the next run resumes from there. On failure the updater returns `Failed`; it does not replace the database with a remote SQLite file.

The publisher implementation itself is not present in the website checkout. Exact live artifacts and the Desktop consumer were available and audited. The VPS backend should consume this existing format as-is.

## 18. Future API Requirements

Minimum API surface derived from current UI:

### `GET /api/games`

Consumers: catalog grid, navbar search, tier tabs, hero, trending.

Parameters:

| Parameter | Required | Purpose |
|---|---|---|
| `q` | No | Title or AppID search |
| `tier` | No | `premium` or `standard` |
| `page` | No | Server-side page number; default 1 |
| `limit` | No | Page size; default 20, bounded maximum |
| `ids` | No | Comma-separated bounded AppID list for hero/trending lookup, preserving requested order |

Initial response fields only:

```json
{
  "items": [
    {
      "appid": 10,
      "title": "Counter-Strike",
      "premium": false,
      "cover_url": "https://..."
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 146851
}
```

No initial genre, protection, price, or sort parameter is required because the current website has no such controls. Add only when UI requirements exist.

Default ordering must be decided explicitly. Exact parity requires the current `appid.json` priority block followed by current website order; SQLite's existing repository ordering does not match that behavior.

### `GET /api/games/{appid}`

Consumer: detail modal.

Required response fields:

```json
{
  "appid": 10,
  "title": "Counter-Strike",
  "premium": false,
  "cover_url": "https://...",
  "publishers": ["Valve"],
  "genres": ["Action"],
  "specification": {
    "minimum": "...",
    "recommended": "..."
  }
}
```

`publishers` cannot currently be produced from SQLite alone. Resolve that gap before claiming detail parity. Do not include developers, screenshots, movies, descriptions, price, protection, or other unused fields in the first API response.

### No frontend endpoint required

- No public manifest/patch endpoint beyond existing R2 artifacts; updater is backend-internal.
- No `/api/catalog/version` is required by current frontend.
- No separate `/api/search` is needed; `q` belongs on `/api/games`.
- No separate popular endpoint is needed if bounded `ids` lookup is supported and `appid_populer.json` remains editorial config.

## 19. KEEP / REPLACE / RETIRE

### KEEP

- GitHub Pages frontend and `CNAME`.
- `index.html`, `showcase.html`, current visual design, sections, navigation, modal, keyboard handling, and accessibility focus trap.
- `js/app.js` card rendering and shared UI utilities, if API response preserves the current card shape.
- `appid.json` and `appid_populer.json` as editorial configuration until ordering is intentionally moved server-side.
- Image URL validation, lazy loading, async decoding, and gradient fallback.
- Existing R2 `catalog_manifest.json` and patches exactly as published.
- Existing Catalog Builder / Publisher as the single source of truth.

### REPLACE

- Full `search_index.json` browser fetch -> paginated `GET /api/games`.
- Browser title/AppID search -> SQLite-backed `q` query.
- Browser Premium/Standard scan -> SQLite-backed tier query.
- Client display-only load-more -> server pagination.
- Direct R2 detail fetch -> `GET /api/games/{appid}`.
- Browser override merge -> backend reading effective catalog values.
- Website R2 metadata sync workflow -> VPS manifest/patch updater.

### RETIRE AFTER PARITY VERIFICATION

- `web_catalog_builder/output/search_index.json` and `.gz`.
- `web_catalog_builder/output/overrides.json`.
- `web_catalog_builder/output/r2_manifest.json`.
- `web_catalog_builder/games_list.json`, only after membership parity/policy is resolved.
- `web_catalog_builder/build_index.py`, `catalog_index.py`, and their tests.
- `integrations/nexaplay-metadata-override/` old web sync bundle.
- `web_catalog_builder/build_web_catalog.py` and cached override input.
- `web_catalog_builder/output/catalog.json`.
- `web_catalog_builder/output/chunks/`.
- `resume_state.json*`.
- Dead `GAMES_DATA` from `js/data.js`.

Do not retire rollback files before production API/list/detail/CORS verification and an explicit cleanup task.

## 20. Migration Impact Map

| File | Current responsibility | Future responsibility | Change level |
|---|---|---|---|
| `index.html` | Catalog controls and containers | Same UI; optional API config hook only | SMALL |
| `js/index.js` | Fetch all data, search/filter, pagination, R2 detail, modal control | Fetch paginated API data and detail while keeping rendering behavior | MEDIUM |
| `js/catalog-data.js` | Normalize tuple/R2 data and merge overrides | Unneeded if API returns final validated fields | RETIRE |
| `js/app.js` | Shared card rendering and UI utilities | Same, assuming API adapter preserves shape | NONE |
| `js/data.js` | Dead games, marquee publishers, FAQ | Keep publishers/FAQ; remove dead games later | SMALL |
| `appid.json` | Priority order | Keep temporarily or move to backend config | NONE/SMALL |
| `appid_populer.json` | Trending rank | Keep temporarily; use API `ids` lookup | NONE/SMALL |
| `web_catalog_builder/output/search_index.json` | Full browser catalog | None | RETIRE |
| `web_catalog_builder/output/search_index.json.gz` | Unused precompressed copy | None | RETIRE |
| `web_catalog_builder/output/overrides.json` | Browser detail corrections | None after effective backend data | RETIRE |
| `web_catalog_builder/output/r2_manifest.json` | Old R2 object sync state | None | RETIRE |
| `web_catalog_builder/games_list.json` | Website membership/master | Temporary reconciliation input only | RETIRE after parity decision |
| `web_catalog_builder/build_index.py` | Generate static browser index | None | RETIRE |
| `web_catalog_builder/catalog_index.py` | Cover compaction/fallback | Backend returns final URL | RETIRE |
| `web_catalog_builder/build_web_catalog.py` | Legacy full catalog/chunks | None | RETIRE |
| `web_catalog_builder/output/catalog.json` | Rollback full catalog | None after production verification | RETIRE |
| `web_catalog_builder/output/chunks/` | Rollback detail data | None after production verification | RETIRE |
| `tests/catalog-data.test.js` | Test browser merge adapter | Replace with API contract tests | RETIRE |
| `web_catalog_builder/tests/test_catalog_index.py` | Test static index | Replace with backend query/API tests | RETIRE |
| `integrations/nexaplay-metadata-override/scripts/sync_nexaplay_web.py` | Sync R2 metadata into static website data | Replaced by manifest/patch updater | RETIRE |
| `integrations/nexaplay-metadata-override/.github/workflows/sync-nexaplay-web.yml` | Cross-repo generated file updates | None | RETIRE |
| `CNAME` | GitHub Pages custom domain | Same | NONE |
| `showcase.html`, `js/showcase.js`, showcase CSS | Product/pricing/FAQ page | Same | NONE |
| Existing historical docs | Record old design/setup | Keep historical; do not rewrite in migration | NONE |

New backend files are intentionally not specified here because implementation is out of scope.

## 21. Risks / Unknowns

1. **Catalog membership decision:** using all SQLite rows adds 16,503 games; preserving current membership still leaves 92 website games absent from SQLite.
2. **Tier parity:** 8,687 common games differ. Existing website intentionally freezes tier for old games, while SQLite uses current catalog values. Product policy must choose authority.
3. **Title parity:** 20,710 exact differences include casing, renamed games, trademark characters, and materially different titles.
4. **Artwork parity:** 7,252 common games lack effective SQLite cover; direct migration would replace working website covers with placeholders.
5. **Publisher gap:** current detail UI requires publishers, but schema/patches do not contain them.
6. **Genre/requirements coverage:** schema exists, but thousands of common rows have empty values.
7. **Ordering:** SQLite repository defaults to normalized-name or price-band randomized browse ordering, neither of which matches current website priority + master-list order.
8. **Search semantics:** current AppID search is substring-based; Desktop SQLite search treats a numeric query as exact AppID.
9. **Runtime overrides:** current Desktop runtime DB has 165 local overrides. At this historical decision point, VPS behavior still had to choose between base `games` and an effective override feed. Section 23 records the final decision: Web uses `games` only and ignores `catalog_runtime_overrides`.
10. **Publisher pipeline source:** live artifacts and Desktop consumer were audited, but publisher source code was not present in this website checkout. Any schema addition must be made in the existing publisher, not a website-only publisher.
11. **Baseline recovery:** manifest minimum supported version currently equals 2. A VPS database older than minimum needs a controlled seed replacement path; protocol intentionally provides no remote full SQLite.
12. **API availability:** GitHub Pages remains usable only if VPS API, TLS, DNS, Nginx, and CORS are healthy. Define frontend error/loading behavior before cutover.
13. **Rollback assets:** large legacy files are currently the documented rollback path. Cleanup must be a later explicit action.

### Out of scope

- Showcase pricing and FAQ behavior.
- Navigation, cursor, animation, theme, typography, and responsive design.
- Payment, authentication, contact, support, download, and licensing flows; no catalog-coupled implementation exists in this repository.
- GitHub Pages deployment changes.
- Desktop UI behavior except where needed to document SQLite and patch compatibility.

## 22. Recommended Migration Order

### Phase 0 - Parity and policy gate

1. Export a machine-readable comparison of website membership versus catalog version 4.
2. Decide whether website keeps 146,851-game membership or adopts the full SQLite catalog.
3. Resolve 92 missing website AppIDs through the existing Catalog Builder / Publisher.
4. Decide tier authority for 8,687 mismatches.
5. Resolve cover coverage and publisher requirement through the existing publisher/schema, or explicitly approve visible UI degradation/removal.
6. Freeze API response contracts from actual UI fields only.

### Phase 1 - VPS backend skeleton and read-only SQLite

- Serve health checks internally.
- Open local SQLite read-only for requests.
- Implement bounded queries and response validation.
- Keep frontend untouched.

### Phase 2 - Existing manifest/patch updater

- Fetch the existing R2 manifest.
- Validate version chain, size, SHA-256, schema, and same-origin patch paths.
- Apply each patch transactionally in order.
- Add startup/scheduled update locking and failure logging.
- Add controlled reseed operations for unsupported baselines; do not publish a second catalog.

### Phase 3 - Listing API

- Implement `GET /api/games` with page, limit, tier, and bounded `ids`.
- Implement current default-order policy.
- Return only AppID, title, tier boolean, cover, and total.
- Verify membership, tier, cover, popular, and priority parity.

### Phase 4 - Search API

- Add `q` to the same listing endpoint.
- Decide exact versus substring numeric AppID semantics.
- Test normalization parity and bounded query lengths.

### Phase 5 - Detail API

- Implement `GET /api/games/{appid}`.
- Return only publisher, genres, requirements, and card fields.
- Do not cut over until publisher gap is resolved or UI behavior is explicitly changed.

### Phase 6 - Frontend replacement page-by-page

1. Switch catalog listing/load-more.
2. Switch search and tier filters.
3. Switch hero/trending lookups.
4. Switch detail modal.
5. Preserve GitHub Pages, UI, accessibility, and artwork fallbacks.

### Phase 7 - Production verification

- Verify TLS, CORS, pagination, search, detail, failure states, and rate limits.
- Compare sampled and aggregate results against approved parity rules.
- Keep static rollback assets during an observation window.

### Phase 8 - Retire old website data system

- Stop the old cross-repository web catalog workflow.
- Remove static index, browser override merge, R2 detail fetch, legacy full catalog/chunks, builders, sync state, and dead tests only in an explicit cleanup task.
- Keep the existing Catalog Builder / Publisher and manifest/patch protocol as the single source of truth.

## 23. CURRENT IMPLEMENTATION - SQLITE + VPS API MIGRATION (2026-09-16)

This section supersedes earlier recommendations where final product decisions changed. Historical audit remains intact above.

### Implemented architecture

```text
Existing Catalog Builder -> Publisher -> R2 manifest + patches
                                         |
                                         v
                         VPS-local catalog.sqlite games table
                                         |
Remote appid_populer.json -> five-minute priority cache
Local appid_trending.json -> ordered Game Terpopuler IDs
                                         |
                                         v
                                  FastAPI backend
                              127.0.0.1:8010 only
                                         |
                                         v
                       Nginx api.nexaplayid.store
                                         |
                                         v
                       GitHub Pages nexaplayid.store
```

The SQLite `games` table is final website metadata authority. `price_normalized`, `price_display`, and `protection` remain patch-managed but are absent from public API responses.

### Backend implementation

- `backend/app/catalog_repository.py` reads Web metadata directly from `games`, then performs SQLite-side pagination, search, tier filtering, ordered IDs lookup, and safe JSON parsing. It does not join `catalog_runtime_overrides`. Empty-query browse requires an HTTP(S) `library_capsule`; search intentionally keeps posterless matches.
- `backend/app/catalog_updater.py` consumes unchanged `https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json`, restricts patches to same origin, validates size/SHA-256/schema/chain/rows, and applies every existing game column in one transaction per patch.
- `backend/app/priority_service.py` caches remote `appid_populer.json` for five minutes with conditional HTTP, in-flight deduplication, atomic last-known-good state, duplicate removal, invalid-ID filtering, and network-failure fallback.
- Priority IDs with posters are ordered before remaining poster-bearing SQLite rows. Ordering happens before `LIMIT`/`OFFSET`, so page boundaries and totals match visible browse results.
- `GET /api/games/trending` reads local `appid_trending.json`, preserves order, resolves metadata from SQLite, skips only invalid/missing IDs, and retains posterless games for the existing placeholder.
- `GET /api/stats` returns `actual_count` from `COUNT(*)` and presentation-only `display_count` from `backend/data/display_stats.json` (or configured path). Whole elapsed hours are calculated on request; no hourly worker or write exists. State writes are atomic and occur only at initialization or when actual count overtakes the projected display count.
- Public routes are `GET /api/health`, `GET /api/games`, `GET /api/games/trending`, `GET /api/games/{appid}`, and `GET /api/stats`.
- Uvicorn listens only on `127.0.0.1:8010`; Nginx exposes `https://api.nexaplayid.store`. Port `8000` remains assigned to the existing Telegram service.
- `backend/systemd/` and `backend/nginx/` provide isolated deployment configuration. Existing Telegram and Discord configuration is untouched.

### Final Web metadata authority

Current metadata flow is:

```text
Catalog Builder -> catalog_manifest.json + patches -> updater -> games -> FastAPI -> frontend
```

The runtime path `catalog_runtime_overrides -> Web API` has been removed. A Desktop-derived SQLite snapshot may still contain that table, but its rows have no effect on Web list, search, trending, tier filtering, or detail responses. Patches update `games`; API responses use those updated values without an effective override merge. The table is not dropped or cleaned by the Web updater.

### Frontend implementation

- Initial browser catalog data is bounded to `/api/games?page=1&limit=20` plus `/api/games/trending`.
- Load More requests next server page. Search and Premium/Standard selection reset to page one and query backend.
- Request generation plus `AbortController` prevents stale search results from replacing newer results.
- Detail modal opens immediately in loading state, then reads only `/api/games/{appid}`.
- Posterless search and trending results use the existing generated gradient placeholder.
- One `/api/stats` request per page load updates headline/sentence counts as rounded thousands, compact stats as `K+`/`M+`, and total presentation as localized exact count. Static HTML remains the failure fallback.
- Browser runtime has no 163K dataset, static search-index, overrides, raw GitHub priority fetch, or R2 `Metadata/{appid}.json` fetch.

### Final AppID source roles

- Local `appid_trending.json`: active ordered Game Terpopuler list only; currently 10 AppIDs. Metadata always comes from SQLite.
- Remote `https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/main/appid_populer.json`: active normal catalog priority only; 249 AppIDs when checked on 2026-09-16. Metadata always comes from SQLite.
- No active remote `appid.json` requirement remains.

Local legacy `appid.json` and static catalog artifacts were removed after production verification. Local `appid_trending.json` remains active runtime configuration.

### Verification evidence

- Backend fixture suite: 22 tests passed; two opt-in live-network tests skipped. Coverage includes stale runtime overrides, databases without the override table, patch-to-repository visibility, remote cache behavior, priority-before-pagination, poster filtering, posterless search/trending, stats monotonicity, public fields, CORS, and updater safety.
- Production verification confirmed that patched `games` metadata and public API output match after the repository fix. AppID `307780` was a regression example, not a permanent runtime dependency.
- Frontend suite: 10 tests passed, covering API URL construction, stale-request protection, poster placeholders, count formatting, and removal of obsolete featured/catalog flows.
- Copied production-seed integration passed without modifying the source database: 163,262 actual games, 10,429 Premium, 152,833 Standard, and 155,892 poster-bearing browse rows. Seed update chain version 2 -> 4 also passed on a disposable copy.
- Browser smoke passed at desktop and 390x844 mobile widths: dynamic counts, 10 ordered trending cards, remote-priority browse order, 20 -> 40 unique Load More results, posterless AppID 7650 search placeholder, Premium/Standard filters, detail genre/specification content, trending placeholder rendering, zero horizontal mobile overflow, and static-count/catalog-error fallback when API is unavailable.
- Production runs behind Nginx at `https://api.nexaplayid.store`; systemd API and updater timer are enabled.

### Artifact status

REMOVED FROM CURRENT WORKING TREE:

- legacy `web_catalog_builder/` source, tests, indexes, full catalog, chunks, state, and caches
- legacy `integrations/nexaplay-metadata-override/` website sync bundle
- local legacy `appid.json`

Historical Git blobs remain until a separately approved history rewrite. Historical Markdown is retained and explicitly labeled obsolete.

STILL REFERENCED:

- `index.html`, `showcase.html`, CSS, `js/app.js`, `js/data.js`, `js/catalog-data.js`, `js/index.js`
- `CNAME`
- `backend/`
- existing external Catalog Builder, Publisher, R2 manifest, and patches

### Production operations

1. Maintain backend configuration through local ignored `backend/.env.production`, uploaded as `/home/nexaplay/nexaplay_web/backend/.env`.
2. Monitor `nexaplay-api.service` and `nexaplay-catalog-update.timer`.
3. Publish catalog manifest and patches through the existing external Publisher; timer applies them without backend redeployment.
4. Maintain DNS through Hostinger, TLS through Certbot, and CORS for the two website origins.

## 24. LOCAL PRODUCTION PREPARATION AND CLEANUP (2026-09-16)

- Obsolete static website catalog artifacts, legacy web catalog builder code, legacy R2 website synchronization code, local `appid.json`, and generated caches were removed after repository-wide runtime reference checks.
- Current browser runtime uses only the FastAPI/SQLite API for catalog metadata. No runtime dependency remains on removed search indexes, chunks, overrides, full catalog JSON, R2 per-game metadata, or legacy AppID lists.
- Production environment configuration is maintained locally as ignored `backend/.env.production` and uploaded as `/home/nexaplay/nexaplay_web/backend/.env`.
- Initial `catalog.sqlite` is uploaded separately to `/home/nexaplay/nexaplay_web/data/catalog.sqlite`; SQLite and runtime state files are gitignored.
- `js/catalog-data.js` remains active for API adapters and count formatting. `js/data.js` remains active for publisher marquee and FAQ content; only its unreachable dummy game catalog was removed.
