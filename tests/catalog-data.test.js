const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../js/catalog-data.js');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'index.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const showcaseHtml = fs.readFileSync(path.join(__dirname, '..', 'showcase.html'), 'utf8');

test('adapts API list fields and derives premium only from tier', () => {
  assert.deepEqual(data.normalizeApiListItem({
    appid: 10,
    name: 'Counter-Strike',
    library_capsule: 'https://example.com/10.jpg',
    tier: 'premium',
    price_normalized: 0,
  }), {
    appid: 10,
    title: 'Counter-Strike',
    premium: true,
    cover_url: 'https://example.com/10.jpg',
    genres: [],
    specification: { minimum: '', recommended: '' },
  });
  assert.equal(data.normalizeApiListItem({ appid: 10, name: 'Game', tier: 'standard' }).premium, false);
});

test('adapts API detail without publisher, price, or protection', () => {
  const detail = data.normalizeApiDetail({
    appid: 20,
    name: 'Game',
    library_capsule: '',
    tier: 'standard',
    genre: ['Action', '', 7],
    pc_requirements: { minimum: 'Windows', recommended: 'Linux' },
    publisher: 'Ignored',
    protection: true,
    price_display: 'Ignored',
  });
  assert.deepEqual(detail, {
    appid: 20,
    title: 'Game',
    premium: false,
    cover_url: '',
    genres: ['Action'],
    specification: { minimum: 'Windows', recommended: 'Linux' },
  });
  assert.equal('publisher' in detail, false);
  assert.equal('protection' in detail, false);
  assert.equal('price_display' in detail, false);
});

test('rejects invalid API list values and unsafe artwork URLs', () => {
  for (const value of [null, [], {}, { appid: 0, name: 'Game', tier: 'standard' }, { appid: 1, name: '', tier: 'standard' }, { appid: 1, name: 'Game', tier: 'gold' }]) {
    assert.equal(data.normalizeApiListItem(value), null);
  }
  assert.equal(data.normalizeApiListItem({ appid: 1, name: 'Game', tier: 'standard', library_capsule: 'javascript:alert(1)' }).cover_url, '');
  assert.equal(data.safeHttpUrl('https://example.com/game.jpg'), 'https://example.com/game.jpg');
});

test('builds server-side search, tier, and page query', () => {
  const url = new URL(data.buildGamesApiUrl('https://api.example.test', {
    q: 'counter strike',
    tier: 'premium',
    page: 3,
    limit: 20,
  }));
  assert.equal(url.pathname, '/api/games');
  assert.equal(url.searchParams.get('q'), 'counter strike');
  assert.equal(url.searchParams.get('tier'), 'premium');
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.get('limit'), '20');
});

test('stale request generations are ignored', () => {
  assert.equal(data.isCurrentRequest(4, 4), true);
  assert.equal(data.isCurrentRequest(3, 4), false);
});

test('production frontend uses only backend catalog endpoints', () => {
  for (const forbidden of [
    'search_index.json',
    'overrides.json',
    'Metadata/',
    'raw.githubusercontent.com',
    "fetch('appid.json')",
    'appid_populer.json',
    'catalogData',
    'orderedCatalogData',
    'catalogOverrides',
  ]) {
    assert.equal(indexSource.includes(forbidden), false, `forbidden runtime source remains: ${forbidden}`);
  }
  assert.match(indexSource, /\/api\/games\/trending/);
  assert.equal(indexSource.includes('/api/games/featured'), false);
  assert.match(indexSource, /\/api\/games\/\$\{appid\}/);
  assert.match(indexSource, /buildGamesApiUrl/);
  assert.match(indexSource, /const page = catalogPage \+ 1/);
  assert.match(indexSource, /currentFilter\.toLowerCase\(\)/);
});

test('hero capsules use backend library capsule data instead of hardcoded AppIDs', () => {
  assert.equal(indexSource.includes('const heroAppids'), false);
  assert.match(indexSource, /\[\.\.\.trendingGames, \.\.\.catalogItems\]/);
  assert.match(indexSource, /game\.cover_url/);
  assert.match(indexSource, /updateHeroCapsulesImages\(\)/);
});

test('formats display counts for each UI identity', () => {
  assert.equal(data.formatGameCount(163417, 'headline'), '163.000+');
  assert.equal(data.formatGameCount(163417, 'sentence'), '163.000+');
  assert.equal(data.formatGameCount(163417, 'compact'), '163.4K+');
  assert.equal(data.formatGameCount(163417, 'exact'), '163.417+');
  assert.equal(data.formatGameCount(999, 'compact'), '999+');
  assert.equal(data.formatGameCount(1000, 'compact'), '1K+');
  assert.equal(data.formatGameCount(9999, 'compact'), '10K+');
  assert.equal(data.formatGameCount(100000, 'compact'), '100K+');
  assert.equal(data.formatGameCount(1000000, 'compact'), '1M+');
  assert.equal(data.formatGameCount('bad', 'exact'), '');
});

test('fetches stats once and keeps semantic count markers on both pages', () => {
  assert.equal((appSource.match(/\/api\/stats/g) || []).length, 1);
  assert.match(indexHtml, /data-game-count="headline"/);
  assert.match(indexHtml, /data-game-count="compact"/);
  assert.match(indexHtml, /data-game-count="exact"/);
  assert.match(showcaseHtml, /data-game-count="sentence"/);
});

test('modal shows loading state before API detail and has no publisher field', () => {
  const loadingPosition = indexSource.indexOf("populateCatalogModal(item, 'loading')");
  const requestPosition = indexSource.indexOf('await fetchGameDetail(appid)');
  assert.ok(loadingPosition >= 0 && loadingPosition < requestPosition);
  assert.equal(indexSource.includes('catalog-modal-publisher'), false);
  assert.match(indexSource, /populateCatalogModal\(item, 'error'\)/);
  assert.match(indexSource, /generateCardPlaceholder/);
});

test('escapes rendered card text', () => {
  assert.equal(data.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});
