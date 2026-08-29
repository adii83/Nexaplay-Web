# R2 Hybrid Catalog Synchronization Design

## Purpose

Automate NexaPlay catalog additions and metadata refreshes without rebuilding or maintaining the existing full catalog and 1,469 detail chunk files manually.

The design connects:

- source repository: `adii83/Nexaplay-Metadata-Override`;
- website repository: `adii83/Nexaplay-Web`;
- metadata bucket exposed at `https://meta.nexaplaymetadata.online/Metadata/{appid}.json`.

The resulting website keeps one compact static search index for fast catalog loading and fetches one game's current detail metadata from R2 only when its card is opened.

## Approved Constraints

1. `new_games.json` is an append-only admission list for new website games.
2. Removing an AppID from `new_games.json` does not remove it from the website.
3. `nexaplay_override.json` is the existing override file in `adii83/Nexaplay-Metadata-Override`.
4. Synchronization reads but never modifies `new_games.json`, `nexaplay_override.json`, or R2 objects.
5. Override values win field-by-field; unspecified fields continue to come from R2 or existing website data.
6. An AppID supplied by `new_games.json` remains the website AppID even when the downloaded metadata contains a different `steam_appid` value.
7. Existing games retain their current Premium/Standard classification.
8. Only newly admitted AppIDs receive the new price classification rule.
9. Detail metadata is fetched live in the browser from R2.
10. A scheduled incremental scan refreshes changed card metadata daily.
11. The existing full catalog and chunk files are removed only after the hybrid flow has been verified in production.

## Sources of Truth

| Source | Responsibility |
|---|---|
| R2 `Metadata/{appid}.json` | Primary game metadata: name, assets, publishers, genres, requirements, price |
| `new_games.json` | Explicit permission to add new AppIDs to the website catalog |
| `nexaplay_override.json` | Sparse corrections for R2/catalog data |
| Website `games_list.json` | Durable compact master list of games already admitted to the website |
| Website `search_index.json` | Browser-optimized card, filter, and search payload |
| Website normalized override file | Browser-readable projection of the source override |
| Website R2 manifest | ETag/Last-Modified state for incremental synchronization |

R2 object existence alone does not admit a game to the website. A previously unknown AppID must appear in `new_games.json`.

## Architecture

### Static catalog path

The page loads one optimized `search_index.json` containing enough information to:

- render cards;
- search by title and AppID;
- filter Premium and Standard games;
- render hero and trending covers.

The tuple contract becomes:

```text
[appid, title, premium_flag, cover_data]
```

where:

- `appid` is an integer;
- `title` is a non-empty string;
- `premium_flag` is `0` or `1`;
- `cover_data` is either an absolute URL, a Steam CDN-relative asset path, or an empty string.

The old fifth `chunk` field is removed after frontend migration because detail chunks are no longer used.

### Live detail path

When a card is opened, the browser requests:

```text
https://meta.nexaplaymetadata.online/Metadata/{appid}.json
```

It extracts only fields needed by the modal, merges the corresponding normalized override in memory, and renders the result. Neither source file is changed.

The browser may download the full JSON object because the current R2 endpoint serves one complete object. It ignores fields not used by the modal.

### Synchronization path

A workflow stored in `Nexaplay-Metadata-Override`:

1. checks out the source repository;
2. checks out `Nexaplay-Web` using a repository-scoped token;
3. validates the source files and website catalog;
4. lists R2 metadata objects through the S3-compatible API;
5. compares object ETags with the previous manifest;
6. fetches only required new or changed JSON objects;
7. merges R2, sparse overrides, and existing website data;
8. updates `games_list.json`, normalized overrides, the R2 manifest, and `search_index.json`;
9. validates invariants;
10. commits and pushes to `Nexaplay-Web` only when output differs.

## Workflow Triggers

The workflow runs on:

```yaml
on:
  push:
    paths:
      - new_games.json
      - nexaplay_override.json
  schedule:
    - cron: "17 2 * * *" # daily at 02:17 UTC
  workflow_dispatch:
```

A concurrency group permits only one catalog synchronization at a time. Pending duplicate runs are cancelled or serialized so they cannot race when updating the website repository.

## New Game Admission

For every integer AppID in `new_games.json` that is absent from the website master list:

1. request `Metadata/{appid}.json` from R2;
2. require HTTP success and valid JSON;
3. preserve the AppID from `new_games.json`, even if `steam_appid` differs;
4. resolve title and cover using the approved fallback rules;
5. classify Premium/Standard using the approved new-game rule;
6. append a unique game entry to the website master list;
7. regenerate the optimized search index.

A missing/invalid R2 object, empty title, or missing cover for any new AppID fails the entire run. No partial additions are pushed.

Removing an AppID from `new_games.json` has no deletion effect.

## Premium Classification for New Games

Existing Premium values are immutable under synchronization. New AppIDs use:

```text
if store_data.is_free is true:
    Standard
elif override.catalog.price_normalized is a non-negative IDR amount:
    Premium if price_normalized >= 135,000, otherwise Standard
elif store_data.price_overview.initial is missing or non-positive:
    Standard
else:
    usd_price = initial / 100
    idr_price = usd_price * 16,000
    Premium if idr_price >= 135,000, otherwise Standard
```

The normal `initial` price is used instead of the discounted `final` price so temporary discounts do not change classification.

This deliberately differs from the historical generator, which fetched Indonesian Steam pricing and used a Rp100,000 threshold. The new R2-based Rp135,000 rule applies only at first admission through `new_games.json`.

If an existing game's R2 price changes, its stored Premium value is retained.

## Card Field Resolution

### Title

Highest priority first:

1. `override.catalog.title`;
2. R2 `name`;
3. existing website title.

### Cover

Highest priority first:

1. `override.catalog.library_capsule`;
2. `override.catalog.library_capsule_2x`;
3. `override.catalog.header`;
4. first R2 `assets.library_capsule[].url`;
5. first R2 `assets.library_capsule_2x[].url`;
6. first R2 `assets.header[].url`;
7. existing website cover/header.

The URL compactor may strip only known Steam CDN prefixes. It must preserve AppID/hash path segments and query strings. Other hostnames remain absolute URLs.

## Modal Field Resolution

The browser merges data per field rather than recursively replacing whole sections.

| Modal field | Resolution order |
|---|---|
| Title | `override.catalog.title` → R2 `name` → search-index title |
| Cover | override catalog assets → R2 assets → search-index cover |
| Developers | `override.detail.developers` → `override.catalog.developers/developer` → R2 `store_data.developers` |
| Publishers | `override.detail.publishers` → `override.catalog.publishers/publisher` → R2 `store_data.publishers` |
| Genres | `override.catalog.genre` → R2 `store_data.genres[].description` |
| Minimum specification | `override.detail.pc_requirements_minimum` → R2 `store_data.pc_requirements.minimum` |
| Recommended specification | `override.detail.pc_requirements_recommended` → R2 `store_data.pc_requirements.recommended` |

Additional override fields may be preserved in the normalized projection for future UI use, but they do not affect current UI behavior unless explicitly mapped.

The merge occurs only in memory for rendering. It never writes to R2 or the source override file.

## Normalized Override Projection

The workflow validates `nexaplay_override.json` and writes a browser-readable projection to the website output directory.

The projection:

- is keyed by string AppID;
- preserves validated `catalog` and `detail` fields from the source override;
- preserves sparse semantics;
- does not invent defaults;
- is compact JSON;
- is served from the website origin rather than fetched from GitHub Raw for every modal.

Only the explicitly mapped fields affect the current UI; preserving other valid source fields avoids a lossy copy without adding behavior.

An override does not admit a previously unknown game. Admission remains the responsibility of `new_games.json`.

## Incremental R2 Scan

The workflow stores an object-state manifest in the website repository. Each entry records at least:

```json
{
  "etag": "object-etag",
  "last_modified": "ISO-8601 timestamp"
}
```

The manifest format includes a version number so future migrations can be explicit.

### First run

The first run lists all `Metadata/*.json` objects and records their state without downloading every existing object. It still downloads metadata required for:

- AppIDs newly admitted by `new_games.json`;
- cataloged AppIDs affected by the current override.

This baseline avoids approximately 146,000 downloads during migration.

### Subsequent runs

The workflow lists R2 objects, compares ETags, and downloads only objects whose state changed.

For a changed existing game:

- update title and cover according to fallback rules;
- preserve Premium/Standard;
- update its manifest state only after successful processing.

For an object not already in the website catalog and not admitted by `new_games.json`:

- record or ignore its object state;
- do not add it to the website.

For an R2 object deletion:

- do not delete the website game;
- retain website card data;
- remove the manifest entry, so restoring the object makes it appear new/changed on the next scan.

### Listing cost

R2 object listing is paginated. The workflow requests object metadata pages rather than downloading every JSON object. Only changed/admitted objects incur object downloads.

## Browser Caching and CORS

R2 must allow browser access from:

```text
https://nexaplayid.store
```

Required methods:

```text
GET, HEAD
```

The response should expose ETag and define a suitable preflight/cache maximum age. Wildcard origins are not required.

The frontend requests detail metadata using browser revalidation semantics (`cache: "no-cache"`), allowing the browser to reuse a cached response when its ETag remains current.

Until CORS is verified in production, old chunks remain available as a rollback path.

## Failure Behavior

### New AppIDs

Any of the following aborts the complete synchronization before commit:

- metadata object missing;
- HTTP/download error;
- malformed JSON;
- missing title;
- no usable cover after all fallbacks;
- duplicate AppID;
- invalid price structure that violates the expected type contract.

### Changed existing AppIDs

If a changed existing object cannot be downloaded or parsed:

- retain its existing website entry;
- emit a warning/error summary;
- do not advance that object's manifest ETag;
- retry on the next run.

Other successfully changed existing entries may still be committed, provided global validation passes.

### Frontend detail fetch

If R2 detail fetch fails:

- the modal still shows title, cover, and Premium/Standard from the search index;
- publisher, genre, and specification show an unavailable state rather than stale invented values;
- the error is logged;
- the user can close and reopen/retry the modal.

## Validation Invariants

Before pushing, synchronization verifies:

1. `new_games.json` is a JSON array of unique integer AppIDs;
2. override root is an object keyed by valid AppID strings;
3. website master entries have valid AppID, title, cover/header, and boolean Premium;
4. website AppIDs are unique;
5. no existing AppID disappears;
6. no existing Premium value changes;
7. search-index count equals master-list count;
8. every search-index tuple follows the expected arity/types;
9. generated JSON can be parsed again;
10. output count does not unexpectedly decrease;
11. normalized override contains only validated mappings;
12. manifest version and entry types are valid.

The script supports a dry-run/check mode that performs fetches and validations but writes no repository files or commits.

## Repository Access and Security

The source repository stores these GitHub Actions secrets:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
NEXAPLAY_WEB_TOKEN
```

R2 credentials are restricted to object listing and read access. They cannot write or delete objects.

`NEXAPLAY_WEB_TOKEN` is a fine-grained token limited to:

```text
Repository: adii83/Nexaplay-Web
Permission: Contents read/write
```

The source workflow itself requests only `contents: read`. The cross-repository token is passed explicitly to the website checkout/push step. Secrets are not printed, embedded into generated files, or exposed to untrusted pull-request workflows.

## Cross-Repository Commit Safety

1. Checkout the latest website `main` branch.
2. Run synchronization and validation.
3. Stage only the generated/master files intended by the design.
4. Commit only when there is a diff.
5. Never force-push.
6. If upstream changes cause a non-fast-forward failure, fail safely and retry in a later/manual run.
7. Use a generated commit message that identifies catalog synchronization.
8. Do not trigger the source workflow from the generated website commit.

## Testing

### Script self-checks

Fixture-driven tests cover:

1. US$2.39 normal price → Standard;
2. US$9.99 normal price → Premium;
3. exactly Rp135,000 → Premium;
4. `is_free: true` → Standard;
5. missing price → Standard;
6. `initial` wins over discounted `final`;
7. internal `steam_appid` mismatch preserves admitted AppID;
8. sparse override changes only supplied fields;
9. deleting from `new_games.json` does not delete website entries;
10. existing Premium values remain unchanged;
11. Steam CDN path compaction preserves hash directories/query strings;
12. failed existing-object refresh retains old data and old manifest state;
13. failed new-object refresh aborts all new additions.

### Frontend checks

1. initial catalog loads successfully;
2. title/AppID search works;
3. Premium/Standard filters work;
4. hero and trending covers resolve;
5. opening a card performs one R2 metadata request and no chunk request;
6. publisher, genres, and requirements render from R2;
7. override values win only for mapped fields;
8. R2 failure produces a usable fallback modal;
9. keyboard focus trap/close behavior remains intact;
10. browser console has no CORS or parsing errors in the success path.

### Workflow checks

1. push path filter triggers only for the two source JSON files;
2. scheduled and manual triggers work;
3. concurrency prevents overlapping writers;
4. dry run produces no commit;
5. no-diff run produces no commit;
6. invalid new AppID fails before push;
7. credentials are not printed;
8. generated push is fast-forward only.

## Migration Sequence

1. Configure and verify R2 CORS for the production website origin.
2. Add normalized override loading and live R2 detail fetching to the website while retaining old chunks as rollback.
3. Add the synchronization script and workflow files intended for `Nexaplay-Metadata-Override`.
4. Configure repository and R2 read-only secrets.
5. Run script fixtures and frontend tests locally.
6. Run the workflow manually in dry-run mode.
7. Run the first real synchronization, creating the ETag baseline.
8. Verify production card rendering, filters, modal detail, override behavior, and CORS.
9. Remove `catalog.json`, chunk files, chunk-building code, and chunk frontend fallback only after production verification.

## Deliverables

### In `Nexaplay-Web`

- frontend live-detail and sparse-override merge logic;
- updated search-index tuple handling without chunk dependency;
- compact normalized override output;
- R2 incremental manifest output;
- updated catalog builder/index utilities as needed;
- fixture/self-check coverage;
- migration/setup documentation;
- eventual removal of obsolete catalog/chunk assets after verification.

### To copy into `Nexaplay-Metadata-Override`

- `scripts/sync_nexaplay_web.py`;
- `.github/workflows/sync-nexaplay-web.yml`;
- a concise setup guide listing required secrets, R2 policy, CORS, dry run, and recovery steps.

## Non-Goals

- Writing back to R2;
- modifying source `new_games.json` or `nexaplay_override.json`;
- automatically deleting website games;
- admitting every R2 object automatically;
- recalculating Premium for the existing catalog;
- adding a Cloudflare Worker projection endpoint in this phase;
- fetching all metadata objects in the browser or during each Action run.
