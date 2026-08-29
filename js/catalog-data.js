(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NexaCatalogData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STEAM_ASSET_BASE = 'https://shared.steamstatic.com/store_item_assets/steam/apps/';

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function firstText() {
    for (const value of arguments) {
      const result = text(value);
      if (result) return result;
    }
    return '';
  }

  function stringList(value) {
    if (Array.isArray(value)) return value.map(text).filter(Boolean);
    const item = text(value);
    return item ? [item] : [];
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(text(value));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function resolveCoverUrl(value) {
    const cover = text(value);
    if (!cover || cover === 'NO CONTENT') return '';
    return safeHttpUrl(/^https?:\/\//i.test(cover) ? cover : `${STEAM_ASSET_BASE}${cover}`);
  }

  function isUsableMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (text(value.name) || firstAssetUrl(value.assets)) return true;
    const store = value.store_data;
    if (!store || typeof store !== 'object' || Array.isArray(store)) return false;
    if (stringList(store.developers).length || stringList(store.publishers).length) return true;
    if (Array.isArray(store.genres) && store.genres.some(genre => text(genre && genre.description))) return true;
    const requirements = store.pc_requirements;
    return Boolean(requirements && typeof requirements === 'object' && !Array.isArray(requirements)
      && (text(requirements.minimum) || text(requirements.recommended)));
  }

  function normalizeCatalogItem(item) {
    if (!Array.isArray(item) || item.length < 4) return null;
    const appid = Number(item[0]);
    const title = text(item[1]);
    if (!Number.isInteger(appid) || appid <= 0 || !title) return null;

    return {
      appid,
      title,
      premium: item[2] === 1,
      cover_url: resolveCoverUrl(item[3]),
      publishers: [],
      genres: [],
      specification: { minimum: '', recommended: '' },
    };
  }

  function firstAssetUrl(assets) {
    if (!assets || typeof assets !== 'object') return '';
    for (const key of ['library_capsule', 'library_capsule_2x', 'header']) {
      const candidates = assets[key];
      if (!Array.isArray(candidates)) continue;
      for (const candidate of candidates) {
        const url = resolveCoverUrl(candidate && candidate.url);
        if (url) return url;
      }
    }
    return '';
  }

  function extractModalData(metadata) {
    const source = metadata && typeof metadata === 'object' ? metadata : {};
    const store = source.store_data && typeof source.store_data === 'object'
      ? source.store_data
      : {};
    const requirements = store.pc_requirements && typeof store.pc_requirements === 'object'
      ? store.pc_requirements
      : {};
    const genres = Array.isArray(store.genres)
      ? store.genres.map(genre => text(genre && genre.description)).filter(Boolean)
      : [];

    return {
      title: text(source.name),
      cover_url: resolveCoverUrl(firstAssetUrl(source.assets)),
      developers: stringList(store.developers),
      publishers: stringList(store.publishers),
      genres,
      specification: {
        minimum: text(requirements.minimum),
        recommended: text(requirements.recommended),
      },
    };
  }

  function overridePeople(detail, catalog, plural, singular) {
    if (Object.prototype.hasOwnProperty.call(detail, plural)) return stringList(detail[plural]);
    if (Object.prototype.hasOwnProperty.call(catalog, plural)) return stringList(catalog[plural]);
    if (Object.prototype.hasOwnProperty.call(catalog, singular)) return stringList(catalog[singular]);
    return null;
  }

  function overrideGenres(catalog) {
    if (!Object.prototype.hasOwnProperty.call(catalog, 'genre')) return null;
    if (Array.isArray(catalog.genre)) return stringList(catalog.genre);
    return text(catalog.genre).split(',').map(text).filter(Boolean);
  }

  function overrideCover(catalog) {
    for (const candidate of [catalog.library_capsule, catalog.library_capsule_2x, catalog.header]) {
      const url = resolveCoverUrl(candidate);
      if (url) return url;
    }
    return '';
  }

  function mergeModalData(extracted, override, fallback) {
    const r2 = extracted && typeof extracted === 'object' ? extracted : {};
    const normalizedOverride = override && typeof override === 'object' ? override : {};
    const catalog = normalizedOverride.catalog && typeof normalizedOverride.catalog === 'object'
      ? normalizedOverride.catalog
      : {};
    const detail = normalizedOverride.detail && typeof normalizedOverride.detail === 'object'
      ? normalizedOverride.detail
      : {};
    const indexItem = fallback && typeof fallback === 'object' ? fallback : {};
    const r2Specification = r2.specification && typeof r2.specification === 'object'
      ? r2.specification
      : {};
    const developers = overridePeople(detail, catalog, 'developers', 'developer');
    const publishers = overridePeople(detail, catalog, 'publishers', 'publisher');
    const genres = overrideGenres(catalog);

    return {
      appid: indexItem.appid,
      title: firstText(catalog.title, r2.title, indexItem.title),
      premium: Boolean(indexItem.premium),
      cover_url: firstText(overrideCover(catalog), resolveCoverUrl(r2.cover_url), resolveCoverUrl(indexItem.cover_url)),
      developers: developers === null ? stringList(r2.developers) : developers,
      publishers: publishers === null ? stringList(r2.publishers) : publishers,
      genres: genres === null ? stringList(r2.genres) : genres,
      specification: {
        minimum: Object.prototype.hasOwnProperty.call(detail, 'pc_requirements_minimum')
          ? text(detail.pc_requirements_minimum)
          : text(r2Specification.minimum),
        recommended: Object.prototype.hasOwnProperty.call(detail, 'pc_requirements_recommended')
          ? text(detail.pc_requirements_recommended)
          : text(r2Specification.recommended),
      },
    };
  }

  return { normalizeCatalogItem, resolveCoverUrl, escapeHtml, safeHttpUrl, isUsableMetadata, extractModalData, mergeModalData };
});
