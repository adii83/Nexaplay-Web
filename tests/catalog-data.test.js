const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('ignores legacy chunk field', () => {
  const result = data.normalizeCatalogItem([40, 'Deathmatch Classic', 1, '', 12]);

  assert.deepEqual(result, {
    appid: 40,
    title: 'Deathmatch Classic',
    premium: true,
    cover_url: '',
    publishers: [],
    genres: [],
    specification: { minimum: '', recommended: '' },
  });
  assert.equal('chunk' in result, false);
  assert.equal('_fullDataLoaded' in result, false);
});

test('preserves absolute Steam cover URL', () => {
  const cover = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/30/hash/library.jpg?t=1';

  assert.equal(data.resolveCoverUrl(cover), cover);
});

test('rejects malformed index tuples', () => {
  assert.equal(data.normalizeCatalogItem(null), null);
  assert.equal(data.normalizeCatalogItem([30, 'Too short', 0]), null);
  assert.equal(data.normalizeCatalogItem(['invalid', 'Title', 0, '']), null);
  assert.equal(data.normalizeCatalogItem([0, 'Zero', 0, '']), null);
  assert.equal(data.normalizeCatalogItem([-1, 'Negative', 0, '']), null);
  assert.equal(data.normalizeCatalogItem([1.5, 'Fraction', 0, '']), null);
  assert.equal(data.normalizeCatalogItem([30, '  ', 0, '']), null);
});

test('extracts R2 modal fields and preferred cover asset', () => {
  const result = data.extractModalData({
    name: 'R2 title',
    assets: {
      library_capsule: [{ url: '1/library.jpg' }],
      library_capsule_2x: [{ url: '1/library-2x.jpg' }],
      header: [{ url: '1/header.jpg' }],
    },
    store_data: {
      developers: ['R2 Dev'],
      publishers: ['R2 Publisher'],
      genres: [{ description: 'Action' }, { description: 'Adventure' }],
      pc_requirements: { minimum: 'min', recommended: 'rec' },
    },
  });

  assert.deepEqual(result, {
    title: 'R2 title',
    cover_url: 'https://shared.steamstatic.com/store_item_assets/steam/apps/1/library.jpg',
    developers: ['R2 Dev'],
    publishers: ['R2 Publisher'],
    genres: ['Action', 'Adventure'],
    specification: { minimum: 'min', recommended: 'rec' },
  });
});

test('skips malformed R2 cover before later valid asset', () => {
  const result = data.extractModalData({
    assets: {
      library_capsule: [{ url: 'https://[' }],
      library_capsule_2x: [{ url: 'https://example.com/valid.jpg' }],
    },
  });
  assert.equal(result.cover_url, 'https://example.com/valid.jpg');
});

test('skips malformed override cover before later valid cover', () => {
  const result = data.mergeModalData({}, {
    catalog: {
      library_capsule: 'https://[',
      library_capsule_2x: 'https://example.com/override.jpg',
    },
  }, { appid: 10, title: 'Game', premium: false, cover_url: '' });
  assert.equal(result.cover_url, 'https://example.com/override.jpg');
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
  assert.deepEqual(result.specification, { minimum: 'min', recommended: 'rec' });
});

test('applies title and cover precedence per field', () => {
  const r2 = {
    title: 'R2 title',
    cover_url: 'https://example.com/r2.jpg',
    developers: [],
    publishers: [],
    genres: [],
    specification: { minimum: '', recommended: '' },
  };
  const fallback = {
    appid: 77,
    title: 'Fallback title',
    premium: true,
    cover_url: 'https://example.com/fallback.jpg',
  };

  assert.deepEqual(data.mergeModalData(r2, {}, fallback), {
    appid: 77,
    title: 'R2 title',
    premium: true,
    cover_url: 'https://example.com/r2.jpg',
    developers: [],
    publishers: [],
    genres: [],
    specification: { minimum: '', recommended: '' },
  });

  const overridden = data.mergeModalData(r2, {
    catalog: {
      title: 'Override title',
      library_capsule: '77/override-library.jpg',
      library_capsule_2x: '77/override-library-2x.jpg',
      header: '77/override-header.jpg',
    },
  }, fallback);
  assert.equal(overridden.title, 'Override title');
  assert.equal(
    overridden.cover_url,
    'https://shared.steamstatic.com/store_item_assets/steam/apps/77/override-library.jpg',
  );
});

test('normalizes scalar catalog developer and publisher overrides', () => {
  const result = data.mergeModalData(
    data.extractModalData({}),
    { catalog: { developer: 'Solo Dev', publisher: 'Solo Publisher' } },
    { appid: 1, title: 'Fallback', premium: false, cover_url: '' },
  );

  assert.deepEqual(result.developers, ['Solo Dev']);
  assert.deepEqual(result.publishers, ['Solo Publisher']);
});

test('splits comma-separated catalog genre override', () => {
  const result = data.mergeModalData(
    data.extractModalData({ store_data: { genres: [{ description: 'R2 genre' }] } }),
    { catalog: { genre: 'Action, Adventure, RPG' } },
    { appid: 1, title: 'Fallback', premium: false, cover_url: '' },
  );

  assert.deepEqual(result.genres, ['Action', 'Adventure', 'RPG']);
});

test('uses independent detail requirement overrides', () => {
  const result = data.mergeModalData(
    data.extractModalData({
      store_data: { pc_requirements: { minimum: 'R2 min', recommended: 'R2 rec' } },
    }),
    { detail: { pc_requirements_minimum: 'Override min' } },
    { appid: 1, title: 'Fallback', premium: false, cover_url: '' },
  );

  assert.deepEqual(result.specification, {
    minimum: 'Override min',
    recommended: 'R2 rec',
  });
});

test('accepts only usable R2 metadata payload objects', () => {
  for (const unavailable of [null, [], {}, 'text', 7, true, { name: '' }, { store_data: {} }, { assets: {} }, { assets: { header: [] } }]) {
    assert.equal(data.isUsableMetadata(unavailable), false);
  }
  for (const available of [
    { name: 'Game' },
    { assets: { header: [{ url: 'https://example.com/cover.jpg' }] } },
    { store_data: { developers: ['Dev'] } },
    { store_data: { publishers: ['Publisher'] } },
    { store_data: { genres: [{ description: 'Action' }] } },
    { store_data: { pc_requirements: { minimum: 'Windows' } } },
  ]) {
    assert.equal(data.isUsableMetadata(available), true);
  }
});

test('escapes card text and allows only HTTP cover URLs', () => {
  assert.equal(data.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(data.safeHttpUrl('https://example.com/game.jpg'), 'https://example.com/game.jpg');
  assert.equal(data.safeHttpUrl('http://example.com/game.jpg'), 'http://example.com/game.jpg');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', '//example.com/x', '1/library.jpg']) {
    assert.equal(data.safeHttpUrl(unsafe), '');
  }
});

test('modal source clears fetch and close timers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'index.js'), 'utf8');
  assert.match(source, /AbortController/);
  assert.match(source, /clearTimeout\(timeout\)/);
  assert.match(source, /clearTimeout\(catalogModalCloseTimer\)/);
  assert.match(source, /modal\.classList\.remove\('is-closing'\)/);
  assert.match(source, /if \(!document\.body\.classList\.contains\('body--modal-open'\)\) \{\s*bodyOverflowBeforeModal = document\.body\.style\.overflow;\s*\}/);
  assert.match(source, /document\.body\.style\.overflow = bodyOverflowBeforeModal;\s*bodyOverflowBeforeModal = null;/g);
});

test('returns safe defaults when R2 fields are missing', () => {
  assert.deepEqual(data.extractModalData(null), {
    title: '',
    cover_url: '',
    developers: [],
    publishers: [],
    genres: [],
    specification: { minimum: '', recommended: '' },
  });

  assert.deepEqual(data.mergeModalData({}, {}, {
    appid: 5,
    title: 'Fallback',
    premium: false,
    cover_url: '5/library.jpg',
  }), {
    appid: 5,
    title: 'Fallback',
    premium: false,
    cover_url: 'https://shared.steamstatic.com/store_item_assets/steam/apps/5/library.jpg',
    developers: [],
    publishers: [],
    genres: [],
    specification: { minimum: '', recommended: '' },
  });
});
