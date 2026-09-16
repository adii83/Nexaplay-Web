(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NexaCatalogData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
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

  function normalizeApiListItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const appid = Number(item.appid);
    const title = text(item.name);
    const tier = text(item.tier).toLowerCase();
    if (!Number.isInteger(appid) || appid <= 0 || !title || !['premium', 'standard'].includes(tier)) {
      return null;
    }
    return {
      appid,
      title,
      premium: tier === 'premium',
      cover_url: safeHttpUrl(item.library_capsule),
      genres: [],
      specification: { minimum: '', recommended: '' },
    };
  }

  function normalizeApiDetail(item) {
    const base = normalizeApiListItem(item);
    if (!base) return null;
    const requirements = item.pc_requirements && typeof item.pc_requirements === 'object'
      ? item.pc_requirements
      : {};
    return {
      ...base,
      genres: Array.isArray(item.genre) ? item.genre.map(text).filter(Boolean) : [],
      specification: {
        minimum: text(requirements.minimum),
        recommended: text(requirements.recommended),
      },
    };
  }

  function buildGamesApiUrl(baseUrl, options = {}) {
    const url = new URL('/api/games', baseUrl);
    if (options.q) url.searchParams.set('q', options.q);
    if (options.tier) url.searchParams.set('tier', options.tier);
    url.searchParams.set('page', String(options.page || 1));
    url.searchParams.set('limit', String(options.limit || 20));
    return url.href;
  }

  function isCurrentRequest(requestGeneration, currentGeneration) {
    return requestGeneration === currentGeneration;
  }

  function formatGameCount(value, mode = 'exact') {
    const count = Math.max(0, Math.floor(Number(value)));
    if (!Number.isFinite(count)) return '';
    const grouped = number => String(number).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (mode === 'headline' || mode === 'sentence') {
      return `${grouped(Math.floor(count / 1000) * 1000)}+`;
    }
    if (mode === 'compact') {
      if (count >= 1000000) return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M+`;
      if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K+`;
      return `${count}+`;
    }
    return `${grouped(count)}+`;
  }

  return {
    buildGamesApiUrl,
    escapeHtml,
    formatGameCount,
    isCurrentRequest,
    normalizeApiDetail,
    normalizeApiListItem,
    safeHttpUrl,
  };
});
