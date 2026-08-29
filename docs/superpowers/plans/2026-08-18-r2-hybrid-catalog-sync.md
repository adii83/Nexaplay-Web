# R2 Hybrid Catalog Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chunk-based game details with live R2 metadata and provide an incremental cross-repository synchronization package driven by `new_games.json` and `nexaplay_override.json`.

**Architecture:** `search_index.json` remains the single browser startup payload. Pure JavaScript adapters normalize R2 and sparse override data before existing modal render functions consume it. A standalone Python synchronizer staged under `integrations/nexaplay-metadata-override/` updates the website master/index from R2 object ETags, while the website's Python index builder owns the compact tuple contract.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in `node:test`, Python 3.12 standard library and `unittest`, AWS CLI on GitHub Actions, Cloudflare R2 S3-compatible listing, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-17-r2-hybrid-catalog-sync-design.md`

## Global Constraints

- Preserve existing uncommitted favicon edits in `index.html`, `showcase.html`, and `assets/`; never overwrite or revert them.
- Do not commit, push, delete tracked catalog/chunk assets, or modify external repositories without separate explicit approval.
- Source override is exactly `adii83/Nexaplay-Metadata-Override/nexaplay_override.json`; synchronization reads it but never writes it.
- `new_games.json` is append-only admission input; removing an AppID never deletes a website game.
- Existing Premium/Standard values never change; only newly admitted games use the approved Rp135,000 rule.
- New-game price: R2 `is_free: true` is always Standard; otherwise `override.catalog.price_normalized` IDR first, then R2 `initial / 100 * 16000`; `>= 135000` is Premium; missing price is Standard.
- AppID from `new_games.json` remains authoritative when R2 `steam_appid` differs.
- R2 details are live only after production CORS allows `https://nexaplayid.store` GET/HEAD requests.
- Keep `output/catalog.json` and `output/chunks/` during rollout; remove them only after production verification and explicit approval.
- Use only platform/standard-library capabilities; add no package manager or runtime dependency.

## File Structure

### Website files

- Create `js/catalog-data.js` — pure catalog tuple, R2 extraction, and sparse override helpers usable in browser and Node tests.
- Create `tests/catalog-data.test.js` — Node built-in tests for tuple normalization and modal data merging.
- Modify `index.html` — load `catalog-data.js` before `index.js`, preserving current favicon edits.
- Modify `js/index.js` — load normalized overrides, fetch one R2 metadata object on modal open, and remove runtime chunk dependency.
- Modify `css/index.css` only if required by the explicit unavailable-detail state; reuse existing `.catalog-modal__empty` where possible.
- Create `web_catalog_builder/catalog_index.py` — reusable compact cover/index functions.
- Replace `web_catalog_builder/build_index.py` — CLI that builds the four-field index from `games_list.json` while preserving existing card covers during migration.
- Create `web_catalog_builder/tests/test_catalog_index.py` — Python standard-library tests for compact/expand-safe cover data and index migration.
- Modify `web_catalog_builder/README.md` — document hybrid output contract and legacy rollout files.
- Generate `web_catalog_builder/output/overrides.json` — initial compact override projection.
- Generate `web_catalog_builder/output/r2_manifest.json` only through synchronizer fixtures/dry run; production manifest comes from first Action run.

### Copy bundle for `Nexaplay-Metadata-Override`

- Create `integrations/nexaplay-metadata-override/scripts/sync_nexaplay_web.py` — standalone cross-repository synchronizer.
- Create `integrations/nexaplay-metadata-override/tests/test_sync_nexaplay_web.py` — fixture tests for admission, classification, ETag baseline/change handling, and failure atomicity.
- Create `integrations/nexaplay-metadata-override/.github/workflows/sync-nexaplay-web.yml` — push/schedule/manual Action.
- Create `integrations/nexaplay-metadata-override/README.md` — exact copy paths, secrets, R2 policy/CORS, dry run, rollout, and recovery.

---

### Task 1: Build and Test Compact Search Index Contract

**Files:**
- Create: `web_catalog_builder/catalog_index.py`
- Modify: `web_catalog_builder/build_index.py`
- Test: `web_catalog_builder/tests/test_catalog_index.py`

**Interfaces:**
- Consumes: game dictionaries containing `appid`, `title`, `premium`, optional `cover_url`, and optional `header`; existing index tuples with four or five fields.
- Produces: `compact_cover_url(url: str) -> str`, `existing_cover_map(rows: list) -> dict[int, str]`, `build_search_rows(games: list[dict], old_rows: list) -> list[list]`, and CLI options `--games-list`, `--existing-index`, `--output`.

- [ ] **Step 1: Write failing cover-contract tests**

Create tests covering known Steam prefixes, absolute override URLs, hash/query preservation, and old five-field migration:

```python
from web_catalog_builder.catalog_index import build_search_rows, compact_cover_url


def test_compact_cover_preserves_hash_path_and_query():
    url = (
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"
        "4659280/e6669/library_capsule_2x.jpg?t=1777111910"
    )
    assert compact_cover_url(url) == (
        "4659280/e6669/library_capsule_2x.jpg?t=1777111910"
    )


def test_build_rows_preserves_old_cover_during_migration():
    games = [{"appid": 30, "title": "Day of Defeat", "premium": False, "header": ""}]
    old_rows = [[30, "Day of Defeat", 0, "30/library_600x900.jpg?t=1", 1]]
    assert build_search_rows(games, old_rows) == [
        [30, "Day of Defeat", 0, "30/library_600x900.jpg?t=1"]
    ]
```

- [ ] **Step 2: Run tests and confirm missing module/functions**

Run:

```bash
python -m unittest discover -s web_catalog_builder/tests -p "test_*.py" -v
```

Expected: failure importing `web_catalog_builder.catalog_index`.

- [ ] **Step 3: Implement minimal pure index functions**

Implement these exact rules:

```python
STEAM_ASSET_PREFIXES = (
    "https://shared.steamstatic.com/store_item_assets/steam/apps/",
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/",
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/",
)


def compact_cover_url(url: str) -> str:
    if not isinstance(url, str) or not url.strip() or url == "NO CONTENT":
        return ""
    value = url.strip()
    for prefix in STEAM_ASSET_PREFIXES:
        if value.startswith(prefix):
            return value[len(prefix):]
    return value
```

`build_search_rows()` must:

1. validate unique integer AppIDs and non-empty titles;
2. use `cover_url`, then `header`, then the old index cover for that AppID;
3. compact the selected cover;
4. emit exactly `[appid, title, 1_or_0, cover_data]`;
5. preserve input game ordering.

- [ ] **Step 4: Replace legacy chunk-producing CLI**

Make `build_index.py` parse:

```text
--games-list web_catalog_builder/games_list.json
--existing-index web_catalog_builder/output/search_index.json
--output web_catalog_builder/output/search_index.json
--check
```

`--check` builds and validates without writing. Normal mode writes atomically through a sibling `.tmp` file. It must not create, rewrite, or delete `output/chunks/`.

- [ ] **Step 5: Run unit and full-data check**

Run:

```bash
python -m unittest discover -s web_catalog_builder/tests -p "test_*.py" -v
python web_catalog_builder/build_index.py --check
```

Expected: all tests pass; check reports `146846` unique games and four-field tuples without modifying tracked files.

- [ ] **Step 6: Review diff checkpoint**

Run:

```bash
rtk git diff -- web_catalog_builder/catalog_index.py web_catalog_builder/build_index.py web_catalog_builder/tests/test_catalog_index.py
```

Do not commit without explicit user approval.

---

### Task 2: Add Pure Browser Data Adapters

**Files:**
- Create: `js/catalog-data.js`
- Test: `tests/catalog-data.test.js`

**Interfaces:**
- Consumes: four- or legacy five-field index tuples, full R2 metadata JSON, sparse normalized override entry, and optional search-index fallback item.
- Produces global/CommonJS API `NexaCatalogData` with `normalizeCatalogItem`, `resolveCoverUrl`, `extractModalData`, and `mergeModalData`.

- [ ] **Step 1: Write failing Node tests**

Use only `node:test` and `node:assert/strict`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../js/catalog-data.js');

test('normalizes four-field tuple without chunk state', () => {
  assert.deepEqual(data.normalizeCatalogItem([30, 'Day of Defeat', 0, '30/library.jpg?t=1']), {
    appid: 30,
    title: 'Day of Defeat',
    premium: false,
    cover_url: 'https://shared.steamstatic.com/store_item_assets/steam/apps/30/library.jpg?t=1',
    publishers: [],
    genres: [],
    specification: { minimum: '', recommended: '' },
  });
});

test('sparse override changes only supplied developer field', () => {
  const metadata = {
    name: 'R2 title',
    store_data: {
      developers: ['R2 Dev'],
      publishers: ['R2 Publisher'],
      genres: [{ description: 'Action' }],
      pc_requirements: { minimum: 'min', recommended: 'rec' },
    },
  };
  const result = data.mergeModalData(
    data.extractModalData(metadata),
    { detail: { developers: ['Override Dev'] } },
    { appid: 1, title: 'Fallback', premium: false, cover_url: '' },
  );
  assert.deepEqual(result.developers, ['Override Dev']);
  assert.deepEqual(result.publishers, ['R2 Publisher']);
  assert.deepEqual(result.genres, ['Action']);
});
```

Also test title/cover precedence, scalar `publisher`/`developer`, comma-separated `catalog.genre`, missing R2 fields, and Steam absolute URL preservation.

- [ ] **Step 2: Run tests and confirm missing module**

Run:

```bash
node --test tests/catalog-data.test.js
```

Expected: failure because `js/catalog-data.js` does not exist.

- [ ] **Step 3: Implement UMD-style pure helper module**

Expose one object in browser and Node without a dependency:

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NexaCatalogData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // pure helpers
  return { normalizeCatalogItem, resolveCoverUrl, extractModalData, mergeModalData };
});
```

`normalizeCatalogItem()` accepts tuple length `>= 4`, ignores old chunk index, and returns no `_fullDataLoaded` or `chunk` fields. `mergeModalData()` applies explicit per-field precedence from the spec; it must not recursively replace entire `catalog` or `detail` objects.

- [ ] **Step 4: Run adapter tests**

Run:

```bash
node --test tests/catalog-data.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Review diff checkpoint**

Run:

```bash
rtk git diff -- js/catalog-data.js tests/catalog-data.test.js
```

Do not commit without explicit user approval.

---

### Task 3: Switch Modal Detail Loading from Chunks to R2

**Files:**
- Modify: `index.html:349-357`
- Modify: `js/index.js:10-229,577-675`
- Modify only if needed: `css/index.css:632-797`
- Test: `tests/catalog-data.test.js`

**Interfaces:**
- Consumes: `NexaCatalogData`, `web_catalog_builder/output/search_index.json`, `web_catalog_builder/output/overrides.json`, and `https://meta.nexaplaymetadata.online/Metadata/{appid}.json`.
- Produces: cached `catalogOverrides` map, `fetchCatalogMetadata(appid) -> Promise<object>`, and an `openCatalogModal()` flow with no chunk request.

- [ ] **Step 1: Load pure helper before page logic**

Add only this script line before `js/index.js`, preserving favicon changes exactly:

```html
<script src="js/catalog-data.js"></script>
<script src="js/index.js"></script>
```

- [ ] **Step 2: Replace local tuple normalization with shared helper**

Add constants/state:

```javascript
const CATALOG_OVERRIDES_URL = './web_catalog_builder/output/overrides.json';
const R2_METADATA_BASE_URL = 'https://meta.nexaplaymetadata.online/Metadata';
let catalogOverrides = {};
```

Replace `normalizeCatalogItem()` implementation or call sites with:

```javascript
NexaCatalogData.normalizeCatalogItem(item)
```

Remove `_fullDataLoaded` and `chunk` assumptions.

- [ ] **Step 3: Load index and overrides together**

`loadCatalogData()` must fetch priority AppIDs, search index, popular AppIDs, and normalized overrides concurrently. A missing override file is non-fatal and resolves to `{}`; a missing search index remains fatal.

Use:

```javascript
fetchJson(CATALOG_OVERRIDES_URL).catch(error => {
  console.warn('Catalog overrides unavailable', error);
  return {};
})
```

Validate the override root as a non-array object before assigning it.

- [ ] **Step 4: Add one-game R2 fetch**

Implement:

```javascript
async function fetchCatalogMetadata(appid) {
  return fetchJson(`${R2_METADATA_BASE_URL}/${appid}.json`, { cache: 'no-cache' });
}
```

Extend `fetchJson(url, options = {})` to pass options to `fetch` without changing existing callers.

- [ ] **Step 5: Replace chunk block in `openCatalogModal()`**

Delete the `catalog-${chunk}.json` request and `Object.assign(item, fullItemData)` block. Before rendering, do:

```javascript
let modalItem = item;
let detailAvailable = true;
try {
  const metadata = await fetchCatalogMetadata(appid);
  const extracted = NexaCatalogData.extractModalData(metadata);
  modalItem = NexaCatalogData.mergeModalData(
    extracted,
    catalogOverrides[String(appid)] || {},
    item,
  );
} catch (error) {
  detailAvailable = false;
  console.error(`Failed to load R2 metadata for AppID ${appid}`, error);
}
```

Render title, cover, publisher, genres, and specifications from `modalItem`. Preserve focus trapping, Escape handling, scroll fade, and close restoration.

- [ ] **Step 6: Render explicit fallback detail state**

When `detailAvailable` is false:

- retain title, cover, and status from search index;
- show publisher as `Detail belum tersedia`;
- hide genres;
- show specification section with the existing `.catalog-modal__empty` copy `Detail game belum tersedia. Tutup lalu buka kembali untuk mencoba lagi.`;
- do not invent stale publisher/genre/specification data.

Reuse existing CSS where possible. Add CSS only if a semantic class is needed; no inline styles.

- [ ] **Step 7: Verify no runtime chunk dependency remains**

Run:

```bash
node --test tests/catalog-data.test.js
python -c "from pathlib import Path; s=Path('js/index.js').read_text(encoding='utf-8'); assert 'output/chunks' not in s; assert 'catalog-${' not in s"
```

Expected: tests pass and assertions produce no output.

- [ ] **Step 8: Run local browser smoke test**

Run a local static server:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/` and verify catalog startup. R2 detail may fail locally until CORS includes localhost; verify fallback modal remains usable. Stop the server after the check.

- [ ] **Step 9: Review diff checkpoint**

Run:

```bash
rtk git diff -- index.html js/index.js css/index.css js/catalog-data.js tests/catalog-data.test.js
```

Confirm favicon edits remain present. Do not commit.

---

### Task 4: Implement Incremental Cross-Repository Synchronizer

**Files:**
- Create: `integrations/nexaplay-metadata-override/scripts/sync_nexaplay_web.py`
- Test: `integrations/nexaplay-metadata-override/tests/test_sync_nexaplay_web.py`

**Interfaces:**
- Consumes: `--source-root`, `--web-root`, `--r2-listing`, `--metadata-base-url`, optional `--dry-run`; source `new_games.json` and `nexaplay_override.json`; website games/index/manifest.
- Produces: updated website `games_list.json`, `output/search_index.json`, `output/overrides.json`, and `output/r2_manifest.json`; exit code nonzero for invalid new admissions.

- [ ] **Step 1: Write failing classification tests**

Test exact function:

```python
classify_new_game(metadata: dict, override: dict) -> bool
```

Fixtures/assertions:

```python
assert classify_new_game({"store_data": {"price_overview": {"initial": 239}}}, {}) is False
assert classify_new_game({"store_data": {"price_overview": {"initial": 999}}}, {}) is True
assert classify_new_game({"store_data": {"is_free": True, "price_overview": {"initial": 9999}}}, {}) is False
assert classify_new_game({"store_data": {}}, {}) is False
assert classify_new_game(
    {"store_data": {"price_overview": {"initial": 1}}},
    {"catalog": {"price_normalized": 135000}},
) is True
```

Add an exact boundary fixture using `initial=843.75` equivalent input only if numeric metadata permits floats; otherwise test boundary through override IDR because Steam minor units are integers.

- [ ] **Step 2: Write failing admission and merge tests**

Test:

- new AppID `3751950` remains `3751950` when metadata says `steam_appid: "242050"`;
- sparse developer override leaves R2 publisher and genres untouched;
- changed existing game preserves its old `premium` value;
- removed `new_games.json` value never deletes master entry;
- duplicate source AppIDs fail validation;
- missing/invalid metadata for one new game returns no partial output.

Use `tempfile.TemporaryDirectory`, local JSON fixtures, and an injected `fetch_metadata(appid)` callable; tests must not access network.

- [ ] **Step 3: Write failing ETag baseline/change tests**

Define listing input contract as AWS CLI JSON:

```json
{
  "Contents": [
    {
      "Key": "Metadata/4659280.json",
      "ETag": "\"0835f093\"",
      "LastModified": "2026-08-17T14:46:10+00:00"
    }
  ]
}
```

Test `plan_sync(listing, manifest, catalog_appids, admitted_appids, override_appids)`:

- missing manifest sets `baseline=True` and does not schedule every catalog AppID;
- new admitted AppIDs and override AppIDs are scheduled during baseline;
- later changed ETag for an existing catalog AppID schedules it;
- unknown changed object not in catalog/admission does not admit it;
- deleted object removes only manifest state, not catalog data;
- failed existing refresh leaves old ETag for retry.

- [ ] **Step 4: Run tests and confirm missing implementation**

Run:

```bash
python -m unittest discover -s integrations/nexaplay-metadata-override/tests -p "test_*.py" -v
```

Expected: import failure for `sync_nexaplay_web`.

- [ ] **Step 5: Implement validation and pure planning functions**

Implement focused functions with these signatures:

```python
def load_unique_appids(path: Path) -> list[int]: ...
def load_override_map(path: Path) -> dict[str, dict]: ...
def classify_new_game(metadata: dict, override: dict) -> bool: ...
def resolve_title(metadata: dict, override: dict, existing: dict | None) -> str: ...
def resolve_cover(metadata: dict, override: dict, existing: dict | None) -> str: ...
def parse_r2_listing(payload: dict) -> dict[int, dict[str, str]]: ...
def project_overrides(source: dict[str, dict]) -> dict[str, dict]: ...
def plan_sync(
    listing: dict[int, dict[str, str]],
    manifest: dict,
    catalog_appids: set[int],
    admitted_appids: set[int],
    override_appids: set[int],
) -> SyncPlan: ...
def synchronize(
    config: SyncConfig,
    fetch_metadata: Callable[[int], dict],
) -> SyncResult: ...
```

Use these frozen dataclass fields exactly:

```python
@dataclass(frozen=True)
class SyncConfig:
    source_root: Path
    web_root: Path
    r2_listing_path: Path
    metadata_base_url: str
    dry_run: bool = False
    overrides_only: bool = False

@dataclass(frozen=True)
class SyncPlan:
    baseline: bool
    new_appids: tuple[int, ...]
    changed_existing_appids: tuple[int, ...]
    override_appids: tuple[int, ...]
    removed_manifest_appids: tuple[int, ...]
    current_objects: dict[int, dict[str, str]]

@dataclass(frozen=True)
class SyncResult:
    added_count: int
    refreshed_count: int
    override_count: int
    warnings: tuple[str, ...]
    changed_paths: tuple[Path, ...]
```

Keep network I/O in one `fetch_json(url, timeout=25)` function so fixture tests inject a replacement. CLI option `--overrides-only` validates/projects `nexaplay_override.json` to website `output/overrides.json` without requiring an R2 listing or metadata fetch; it remains subject to `--dry-run`.

- [ ] **Step 6: Implement atomic website updates**

Build all results in memory first. Validate:

- old AppID set is a subset of new AppID set;
- old premium matches new premium for every old AppID;
- unique valid entries;
- index count equals master count;
- normalized overrides root is valid;
- manifest version is `1`.

Write each changed JSON via `.tmp` and `Path.replace()`. `--dry-run` performs the same calculations/validation and reports counts but writes nothing.

Invoke the website index builder with the current Python executable:

```python
subprocess.run([
    sys.executable,
    str(web_root / "web_catalog_builder" / "build_index.py"),
    "--games-list", str(games_path),
    "--existing-index", str(index_path),
    "--output", str(index_path),
], check=True)
```

For atomic all-or-nothing behavior, run this against temporary staged games/index paths and replace production files only after the subprocess and all validations pass.

- [ ] **Step 7: Implement existing-refresh failure semantics**

New AppID metadata failure raises `SyncError` and prevents all writes. Existing AppID refresh failure:

- retains old title/cover/premium;
- retains old manifest ETag;
- adds one warning to `SyncResult.warnings`;
- allows other valid existing refreshes to commit.

- [ ] **Step 8: Run synchronizer tests**

Run:

```bash
python -m unittest discover -s integrations/nexaplay-metadata-override/tests -p "test_*.py" -v
```

Expected: all fixture tests pass without network.

- [ ] **Step 9: Run combined test suite**

Run:

```bash
python -m unittest discover -s web_catalog_builder/tests -p "test_*.py" -v
python -m unittest discover -s integrations/nexaplay-metadata-override/tests -p "test_*.py" -v
node --test tests/catalog-data.test.js
```

Expected: all pass.

- [ ] **Step 10: Review diff checkpoint**

Run:

```bash
rtk git diff -- integrations/nexaplay-metadata-override web_catalog_builder js tests index.html css/index.css
```

Do not commit.

---

### Task 5: Add GitHub Actions Workflow and Exact Setup Guide

**Files:**
- Create: `integrations/nexaplay-metadata-override/.github/workflows/sync-nexaplay-web.yml`
- Create: `integrations/nexaplay-metadata-override/README.md`
- Modify: `web_catalog_builder/README.md`
- Test: `integrations/nexaplay-metadata-override/tests/test_sync_nexaplay_web.py`

**Interfaces:**
- Consumes GitHub Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `NEXAPLAY_WEB_TOKEN`.
- Produces scheduled/push/manual sync with a dry-run manual input and fast-forward-only website push.

- [ ] **Step 1: Add workflow contract test**

Read workflow as text in Python tests and assert it contains:

```text
push paths: new_games.json, nexaplay_override.json
schedule: 17 2 * * *
workflow_dispatch dry_run input
concurrency group
permissions contents: read
checkout source and adii83/Nexaplay-Web
AWS list-objects-v2
sync_nexaplay_web.py
no force push
```

This test is intentionally structural because no YAML dependency is added.

- [ ] **Step 2: Run test and confirm workflow missing**

Run:

```bash
python -m unittest discover -s integrations/nexaplay-metadata-override/tests -p "test_*.py" -v
```

Expected: workflow contract test fails because file does not exist.

- [ ] **Step 3: Write workflow**

Use exact trigger shape:

```yaml
name: Sync NexaPlay Web Catalog

on:
  push:
    branches: [main]
    paths:
      - new_games.json
      - nexaplay_override.json
  schedule:
    - cron: "17 2 * * *"
  workflow_dispatch:
    inputs:
      dry_run:
        description: Validate without pushing Nexaplay-Web changes
        type: boolean
        default: true

permissions:
  contents: read

concurrency:
  group: nexaplay-web-catalog-sync
  cancel-in-progress: false
```

Steps:

1. checkout source;
2. checkout `adii83/Nexaplay-Web` at `nexaplay-web` using `NEXAPLAY_WEB_TOKEN`;
3. configure AWS environment and list `Metadata/` objects to runner temp JSON;
4. run script with `--dry-run` when manual input is true;
5. when not dry-run, configure bot git identity inside website checkout;
6. stage only games list, search index, overrides, and manifest;
7. commit only when staged diff exists;
8. `git pull --rebase origin main` then plain `git push origin HEAD:main`; never force.

- [ ] **Step 4: Document exact R2 permissions and CORS**

The copy-bundle README must include:

```json
[
  {
    "AllowedOrigins": ["https://nexaplayid.store"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Document read-only R2 token (`Object Read`, `Bucket List`), fine-grained PAT scoped only to `adii83/Nexaplay-Web` with `Contents: Read and write`, copy commands, dry-run invocation, first-run baseline behavior, and non-fast-forward recovery.

- [ ] **Step 5: Update website builder README**

Replace legacy “build enriched catalog/chunks” guidance with:

```text
python web_catalog_builder/build_index.py --check
python web_catalog_builder/build_index.py
```

Document four-field tuple, live R2 detail, normalized overrides, manifest, and that `catalog.json`/`chunks/` remain rollback-only until production verification.

- [ ] **Step 6: Run workflow contract and all tests**

Run:

```bash
python -m unittest discover -s integrations/nexaplay-metadata-override/tests -p "test_*.py" -v
python -m unittest discover -s web_catalog_builder/tests -p "test_*.py" -v
node --test tests/catalog-data.test.js
```

Expected: all pass.

- [ ] **Step 7: Inspect secrets and destructive commands**

Run:

```bash
python -c "from pathlib import Path; s=Path('integrations/nexaplay-metadata-override/.github/workflows/sync-nexaplay-web.yml').read_text(); assert 'push --force' not in s; assert 'reset --hard' not in s; assert 'R2_SECRET_ACCESS_KEY' in s"
```

Expected: no output. Manually confirm secret values themselves never appear.

- [ ] **Step 8: Review diff checkpoint**

Run:

```bash
rtk git diff -- integrations/nexaplay-metadata-override web_catalog_builder/README.md
```

Do not copy, commit, or push externally yet.

---

### Task 6: Generate Initial Local Outputs and Perform End-to-End Verification

**Files:**
- Generate: `web_catalog_builder/output/search_index.json`
- Generate: `web_catalog_builder/output/overrides.json`
- Preserve unchanged: `web_catalog_builder/output/catalog.json`
- Preserve unchanged: `web_catalog_builder/output/chunks/**`
- Modify if required by verified defects only: files from Tasks 1-5

**Interfaces:**
- Consumes implemented builders/adapters and current cached/source override.
- Produces verified four-field index and browser-readable override projection without deleting rollback assets.

- [ ] **Step 1: Generate four-field index atomically**

Run:

```bash
python web_catalog_builder/build_index.py
```

Validate:

```bash
python - <<'PY'
import json
from pathlib import Path
p = Path('web_catalog_builder/output/search_index.json')
rows = json.loads(p.read_text(encoding='utf-8'))
assert len(rows) == 146846
assert all(isinstance(r, list) and len(r) == 4 for r in rows)
assert len({r[0] for r in rows}) == len(rows)
print(len(rows), p.stat().st_size)
PY
```

Expected: `146846` rows; no tuple has chunk index.

- [ ] **Step 2: Seed normalized overrides without external mutation**

Create a temporary source directory containing copies named exactly as the source-repo contract expects:

```bash
python - <<'PY'
import shutil
from pathlib import Path
src = Path('build/override-source')
src.mkdir(parents=True, exist_ok=True)
shutil.copy2('web_catalog_builder/cache/nexaplay_override.json', src / 'nexaplay_override.json')
(src / 'new_games.json').write_text('[]\n', encoding='utf-8')
PY
```

Dry-run projection:

```bash
python integrations/nexaplay-metadata-override/scripts/sync_nexaplay_web.py \
  --source-root build/override-source \
  --web-root . \
  --overrides-only \
  --dry-run
```

Write projection:

```bash
python integrations/nexaplay-metadata-override/scripts/sync_nexaplay_web.py \
  --source-root build/override-source \
  --web-root . \
  --overrides-only
```

Validate:

```bash
python - <<'PY'
import json
from pathlib import Path
source = json.loads(Path('web_catalog_builder/cache/nexaplay_override.json').read_text(encoding='utf-8'))
output = json.loads(Path('web_catalog_builder/output/overrides.json').read_text(encoding='utf-8'))
assert output == source
assert all(str(int(key)) == key for key in output)
print(len(output))
PY
```

The script must not modify `web_catalog_builder/cache/nexaplay_override.json`. Remove only the temporary `build/override-source` directory after verification.

- [ ] **Step 3: Run all automated checks**

Run:

```bash
python -m unittest discover -s web_catalog_builder/tests -p "test_*.py" -v
python -m unittest discover -s integrations/nexaplay-metadata-override/tests -p "test_*.py" -v
node --test tests/catalog-data.test.js
python web_catalog_builder/build_index.py --check
```

Expected: all pass.

- [ ] **Step 4: Check R2 production CORS**

Run:

```bash
curl -sS -D - -o /dev/null \
  -H "Origin: https://nexaplayid.store" \
  "https://meta.nexaplaymetadata.online/Metadata/4659280.json"
```

Required response header:

```text
Access-Control-Allow-Origin: https://nexaplayid.store
```

If absent, report CORS as deployment blocker. Do not delete chunks or claim live production details are ready.

- [ ] **Step 5: Run local browser check**

Start:

```bash
python -m http.server 8000
```

Verify:

1. loader clears;
2. catalog count and cards render;
3. title/AppID search works;
4. Premium/Standard filters work;
5. hero and trending images render;
6. modal opens/closes by click, Enter/Space, Escape;
7. fallback detail works if localhost CORS is not allowed;
8. Network panel has no request to `output/chunks/`.

Stop server afterward.

- [ ] **Step 6: Verify user changes remain untouched**

Run:

```bash
rtk git diff -- index.html showcase.html
rtk git status --short
```

Confirm both favicon links and all `assets/` files still exist. Confirm no unrelated file changed.

- [ ] **Step 7: Update graph after code changes**

Run:

```bash
graphify update .
```

Expected: graph update completes and includes new helpers/synchronizer relationships.

- [ ] **Step 8: Produce completion report without commit/push**

Report:

- changed/created files;
- automated test counts and exact commands;
- browser smoke result;
- CORS result;
- whether generated index changed size;
- explicit statement that chunks/catalog remain for rollback;
- exact files to copy into `Nexaplay-Metadata-Override`;
- remaining external steps (secrets, CORS, copy, manual dry run).

Do not commit or push.

---

### Task 7: Production-Gated Legacy Cleanup

**Files:**
- Delete only after explicit approval: `web_catalog_builder/output/catalog.json`
- Delete only after explicit approval: `web_catalog_builder/output/chunks/**`
- Delete only after explicit approval: `web_catalog_builder/build_web_catalog.py` if no other workflow still uses it
- Modify: `.gitignore`
- Modify: `web_catalog_builder/README.md`

**Interfaces:**
- Consumes: proof that production CORS, live modal fetch, overrides, scheduled sync, and rollback window all passed.
- Produces: smaller repository with no obsolete chunk/catalog maintenance.

- [ ] **Step 1: Require explicit cleanup approval**

Present production evidence and deletion list. Do not proceed based only on prior implementation approval because this removes approximately 1,470 tracked assets and rollback capability.

- [ ] **Step 2: Verify production gates**

Required evidence:

```text
R2 CORS success on nexaplayid.store
live modal R2 request success
normalized override success
GitHub Action dry run success
GitHub Action real sync success
no chunk requests in production
```

- [ ] **Step 3: Delete obsolete assets only after approval**

Delete exact approved paths, update `.gitignore` to prevent regeneration, and remove legacy builder only if repository search shows no caller.

- [ ] **Step 4: Re-run full verification**

Run all Python/Node tests, local browser smoke, `graphify update .`, and a repository search asserting no runtime `output/chunks` or `catalog.json` reference remains.

- [ ] **Step 5: Report cleanup diff**

Show deleted file count and size reduction. Do not commit/push without separate explicit request.
