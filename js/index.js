/* ============================================================
   INDEX.JS — NexaPlay Landing Page Logic
   Hero animation · Parallax · Catalog priority ordering · 20-card pagination
   ============================================================ */

/* —— Device detection helper —— */
const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const isMobile = window.innerWidth < 768;

const API_BASE_URL = window.NEXAPLAY_API_BASE_URL || (
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://127.0.0.1:8000'
    : 'https://api.nexaplayid.store'
);
const CATALOG_BATCH_SIZE = 20;

let currentFilter = 'all';
let catalogItems = [];
let trendingGames = [];
let catalogPage = 0;
let catalogTotal = 0;
let catalogRequestGeneration = 0;
let catalogAbortController = null;
let catalogLoading = false;
let activeCatalogModalAppId = null;
let catalogModalRequestGeneration = 0;
let lastFocusedCatalogCard = null;
let bodyOverflowBeforeModal = null;
let activeCatalogSpecTab = 'minimum';
let catalogModalCloseTimer = null;

/* ————————————————————————————————————————
   1. HERO ENTRANCE ANIMATION
   ———————————————————————————————————————— */

function initHeroAnimation() {
  const heroElements = document.querySelectorAll('.hero-anim');

  gsap.set(heroElements, { opacity: 0, y: isMobile ? 30 : 50 });

  const tl = gsap.timeline({ delay: 0.2 });

  heroElements.forEach((el, i) => {
    tl.to(el, {
      opacity: 1,
      y: 0,
      duration: isMobile ? 0.6 : 0.8,
      ease: 'power3.out',
    }, i * (isMobile ? 0.1 : 0.15));
  });
}


/* ————————————————————————————————————————
   2. HERO PARALLAX CAPSULE GRID
   ———————————————————————————————————————— */

function initHeroCapsules() {
  const container = document.getElementById('hero-capsules');
  if (!container) return;

  const heroAppids = [3357650, 3321460, 3764200, 3159330, 3405690, 2483190];

  heroAppids.forEach((appid) => {
    const gradient = generateCardPlaceholder(appid);
    const capsule = document.createElement('div');
    capsule.className = 'hero__capsule';
    capsule.dataset.heroAppid = appid;
    capsule.style.background = gradient;
    capsule.style.backgroundSize = 'cover';
    capsule.style.backgroundPosition = 'center';
    container.appendChild(capsule);
  });

  if (isTouchDevice) {
    gsap.fromTo(container,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', delay: 0.5 }
    );
    return;
  }

  gsap.to(container, {
    y: -80,
    ease: 'none',
    scrollTrigger: {
      trigger: '.hero',
      start: 'top top',
      end: 'bottom top',
      scrub: 1.5,
    },
  });

  const capsules = container.querySelectorAll('.hero__capsule');
  capsules.forEach((capsule, i) => {
    const speed = 20 + (i % 3) * 25;
    gsap.to(capsule, {
      y: -speed,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: 2,
      },
    });
  });
}


/* ————————————————————————————————————————
   3. TRENDING GAMES GRID
   Intentionally left empty for now.
   ———————————————————————————————————————— */

function renderTrendingGames() {
  const grid = document.getElementById('trending-grid');
  if (!grid) return;
  const rankedGames = trendingGames.slice(0, 10).map((game, index) => ({
    ...game,
    rank: index + 1,
    trending: true,
  }));

  grid.innerHTML = rankedGames.map(game =>
    createGameCardHTML(safeCardData(game), { showRank: true, interactive: true })
  ).join('');
}


/* ————————————————————————————————————————
   4. CATALOG DATA LOADING
   ———————————————————————————————————————— */

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchGameDetail(appid) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetchJson(`${API_BASE_URL}/api/games/${appid}`, {
      cache: 'no-cache',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function safeCardData(item) {
  return {
    ...item,
    title: NexaCatalogData.escapeHtml(item.title),
    cover_url: NexaCatalogData.safeHttpUrl(item.cover_url),
  };
}

async function loadCatalogData() {
  await Promise.all([loadTrendingGames(), loadCatalogPage(true)]);
}


/* ————————————————————————————————————————
   5. CATALOG GRID + FILTERS + SEARCH
   ———————————————————————————————————————— */

async function loadTrendingGames() {
  try {
    const payload = await fetchJson(`${API_BASE_URL}/api/games/trending`, { cache: 'no-cache' });
    trendingGames = Array.isArray(payload)
      ? payload.map(NexaCatalogData.normalizeApiListItem).filter(Boolean)
      : [];
  } catch (error) {
    trendingGames = [];
    console.warn('Trending games unavailable', error);
  }
  renderTrendingGames();
  updateHeroCapsulesImages();
}

async function loadCatalogPage(reset = false) {
  if (reset) {
    catalogRequestGeneration += 1;
    catalogPage = 0;
    catalogItems = [];
    catalogTotal = 0;
    if (catalogAbortController) catalogAbortController.abort();
  }
  if (catalogLoading && !reset) return;

  const generation = catalogRequestGeneration;
  const page = catalogPage + 1;
  const searchInput = document.getElementById('catalog-search');
  const url = NexaCatalogData.buildGamesApiUrl(API_BASE_URL, {
    q: searchInput ? searchInput.value.trim() : '',
    tier: currentFilter === 'all' ? '' : currentFilter.toLowerCase(),
    page,
    limit: CATALOG_BATCH_SIZE,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  catalogAbortController = controller;
  catalogLoading = true;
  setLoadMoreState();
  if (reset) renderCatalogLoading();

  try {
    const payload = await fetchJson(url, { cache: 'no-cache', signal: controller.signal });
    if (!NexaCatalogData.isCurrentRequest(generation, catalogRequestGeneration)) return;
    const items = Array.isArray(payload.items)
      ? payload.items.map(NexaCatalogData.normalizeApiListItem).filter(Boolean)
      : [];
    catalogItems = reset ? items : catalogItems.concat(items);
    catalogPage = Number(payload.page) || page;
    catalogTotal = Number(payload.total) || 0;
    renderCatalog();
  } catch (error) {
    if (error.name === 'AbortError' || !NexaCatalogData.isCurrentRequest(generation, catalogRequestGeneration)) return;
    console.error('Catalog API request failed', error);
    renderCatalogError();
  } finally {
    clearTimeout(timeout);
    if (NexaCatalogData.isCurrentRequest(generation, catalogRequestGeneration)) {
      catalogLoading = false;
      setLoadMoreState();
    }
  }
}

function getCatalogItemByAppid(appid) {
  return catalogItems.find(item => item.appid === appid)
    || trendingGames.find(item => item.appid === appid)
    || null;
}

function getFocusableModalElements(modal) {
  return Array.from(
    modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter(element => !element.hasAttribute('disabled'));
}

function trapCatalogModalFocus(event, modal) {
  if (event.key !== 'Tab') return;

  const focusableElements = getFocusableModalElements(modal);
  if (focusableElements.length === 0) return;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const isShiftTab = event.shiftKey;

  if (isShiftTab && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!isShiftTab && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function hasMeaningfulHtml(value) {
  if (typeof value !== 'string') return false;
  const textContent = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();

  return textContent.length > 0;
}

function setCatalogSpecTab(tabName) {
  const normalizedTab = tabName === 'recommended' ? 'recommended' : 'minimum';
  activeCatalogSpecTab = normalizedTab;

  const buttons = document.querySelectorAll('[data-spec-tab]');
  const panels = document.querySelectorAll('[data-spec-panel]');

  buttons.forEach(button => {
    const isActive = button.getAttribute('data-spec-tab') === normalizedTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  panels.forEach(panel => {
    const isActive = panel.getAttribute('data-spec-panel') === normalizedTab;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });
}

function createCatalogModal() {
  const existingModal = document.getElementById('catalog-modal');
  if (existingModal) return existingModal;

  // Create backdrop (separate element)
  const backdrop = document.createElement('div');
  backdrop.className = 'catalog-modal__backdrop';
  backdrop.id = 'catalog-modal-backdrop';
  document.body.appendChild(backdrop);

  // Create scroll fade indicator (mobile)
  const scrollFade = document.createElement('div');
  scrollFade.className = 'catalog-modal__scroll-fade';
  scrollFade.id = 'catalog-modal-scroll-fade';
  document.body.appendChild(scrollFade);

  // Create the modal itself
  const modal = document.createElement('div');
  modal.className = 'catalog-modal';
  modal.id = 'catalog-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'catalog-modal-title');
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="catalog-modal__media">
      <div class="catalog-modal__image-wrap" id="catalog-modal-image-wrap"></div>
    </div>
    <div class="catalog-modal__content" id="catalog-modal-content">
      <button class="catalog-modal__close" type="button" aria-label="Tutup detail game" data-close-modal="true">
        <span></span><span></span>
      </button>
      <div class="catalog-modal__header">
        <span class="catalog-modal__appid" id="catalog-modal-appid"></span>
        <h3 class="catalog-modal__title" id="catalog-modal-title"></h3>
        <div class="catalog-modal__meta-row" id="catalog-modal-meta-row">
          <span class="catalog-modal__status" id="catalog-modal-status"></span>
        </div>
      </div>
      <div class="catalog-modal__genres-section" id="catalog-modal-genres-section">
        <span class="catalog-modal__section-label">GENRES</span>
        <div class="catalog-modal__genres" id="catalog-modal-genres"></div>
      </div>
      <section class="catalog-modal__spec-section" id="catalog-modal-spec-section">
        <div class="catalog-modal__spec-header">
          <span class="catalog-modal__section-label">SPECIFICATION</span>
          <div class="catalog-modal__spec-tabs" role="tablist" aria-label="Pilihan spesifikasi" id="catalog-modal-spec-tabs">
            <button class="catalog-modal__spec-tab is-active" type="button" role="tab" aria-selected="true" data-spec-tab="minimum">Minimum</button>
            <button class="catalog-modal__spec-tab" type="button" role="tab" aria-selected="false" data-spec-tab="recommended">Recommended</button>
          </div>
        </div>
        <div class="catalog-modal__spec-panel is-active" data-spec-panel="minimum">
          <div id="catalog-modal-minimum"></div>
        </div>
        <div class="catalog-modal__spec-panel" data-spec-panel="recommended" hidden>
          <div id="catalog-modal-recommended"></div>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(modal);

  // Close on backdrop click
  backdrop.addEventListener('click', () => {
    closeCatalogModal();
  });

  // Close on close button click
  modal.addEventListener('click', (event) => {
    const closeTarget = event.target.closest('[data-close-modal="true"]');
    if (closeTarget) {
      closeCatalogModal();
      return;
    }

    const tabButton = event.target.closest('[data-spec-tab]');
    if (tabButton) {
      setCatalogSpecTab(tabButton.getAttribute('data-spec-tab'));
    }
  });

  // Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-active')) {
      closeCatalogModal();
      return;
    }

    if (modal.classList.contains('is-active')) {
      trapCatalogModalFocus(event, modal);
    }
  });

  // Mobile scroll fade indicator
  modal.addEventListener('scroll', () => {
    const fade = document.getElementById('catalog-modal-scroll-fade');
    if (!fade) return;
    const atBottom = modal.scrollHeight - modal.scrollTop - modal.clientHeight < 20;
    fade.classList.toggle('is-hidden', atBottom);
  });

  return modal;
}

/**
 * Parses specification HTML string into structured label/value pairs.
 * Handles common Steam spec HTML format with <strong>Label:</strong> Value patterns.
 */
function parseSpecHtml(specHtml) {
  if (!hasMeaningfulHtml(specHtml)) return [];

  const tempDiv = new DOMParser().parseFromString(specHtml, 'text/html').body;

  const items = [];
  const textContent = tempDiv.textContent || tempDiv.innerText || '';

  // Try to extract label:value pairs from the text
  // Common patterns: "OS: Windows 10", "Processor: Intel Core i5", etc.
  const lines = textContent.split(/\n|<br\s*\/?>/).map(l => l.trim()).filter(Boolean);

  // Also try parsing from strong tags
  const strongs = tempDiv.querySelectorAll('strong');

  if (strongs.length > 0) {
    // Parse structured HTML with <strong> labels
    strongs.forEach(strong => {
      const label = strong.textContent.replace(/:$/, '').trim();
      // Get the text after the strong tag until the next strong or end
      let value = '';
      let nextNode = strong.nextSibling;
      while (nextNode && !(nextNode.nodeType === 1 && nextNode.tagName === 'STRONG')) {
        if (nextNode.nodeType === 3) {
          value += nextNode.textContent;
        } else if (nextNode.nodeType === 1) {
          if (nextNode.tagName === 'BR') {
            break;
          }
          value += nextNode.textContent;
        }
        nextNode = nextNode.nextSibling;
      }
      value = value.replace(/^:\s*/, '').trim();
      if (label && value) {
        items.push({ label, value });
      }
    });
  }

  if (items.length === 0 && lines.length > 0) {
    // Try line-by-line parsing with colon separator
    lines.forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0 && colonIndex < 30) {
        const label = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (label && value) {
          items.push({ label, value });
        }
      }
    });
  }

  return items;
}

/**
 * Renders spec content — tries structured items first, falls back to raw HTML
 */
function renderCatalogSpecContent(targetId, specHtml, fallbackText) {
  const container = document.getElementById(targetId);
  if (!container) return;
  container.replaceChildren();

  if (!hasMeaningfulHtml(specHtml)) {
    const empty = document.createElement('p');
    empty.className = 'catalog-modal__empty';
    empty.textContent = fallbackText;
    container.appendChild(empty);
    return;
  }

  const items = parseSpecHtml(specHtml);
  if (items.length > 0) {
    const list = document.createElement('ul');
    list.className = 'catalog-modal__spec-list';
    items.forEach(item => {
      const row = document.createElement('li');
      row.className = 'catalog-modal__spec-item';
      const label = document.createElement('span');
      label.className = 'catalog-modal__spec-item-label';
      label.textContent = item.label;
      const value = document.createElement('span');
      value.className = 'catalog-modal__spec-item-value';
      value.textContent = item.value;
      row.append(label, value);
      list.appendChild(row);
    });
    container.appendChild(list);
    return;
  }

  const body = document.createElement('div');
  body.className = 'catalog-modal__spec-body';
  body.textContent = specHtml;
  container.appendChild(body);
}

function renderCatalogModalImage(item) {
  const wrap = document.getElementById('catalog-modal-image-wrap');
  if (!wrap) return;
  wrap.replaceChildren();

  const coverUrl = NexaCatalogData.safeHttpUrl(item.cover_url);
  if (coverUrl) {
    const image = document.createElement('img');
    image.className = 'catalog-modal__image';
    image.src = coverUrl;
    image.alt = item.title;
    image.loading = 'lazy';
    image.decoding = 'async';
    wrap.appendChild(image);
    return;
  }

  const placeholder = document.createElement('div');
  placeholder.className = 'catalog-modal__placeholder';
  placeholder.style.background = generateCardPlaceholder(item.appid || 1);
  const text = document.createElement('span');
  text.textContent = 'NO CONTENT';
  placeholder.appendChild(text);
  wrap.appendChild(placeholder);
}

function renderCatalogGenres(genres) {
  const section = document.getElementById('catalog-modal-genres-section');
  const container = document.getElementById('catalog-modal-genres');
  if (!section || !container) return;
  container.replaceChildren();

  if (!Array.isArray(genres) || genres.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  genres.forEach(genre => {
    const chip = document.createElement('span');
    chip.className = 'catalog-modal__genre-chip';
    chip.textContent = genre;
    container.appendChild(chip);
  });
}

function populateCatalogModal(item, state = 'ready') {
  const appidEl = document.getElementById('catalog-modal-appid');
  const titleEl = document.getElementById('catalog-modal-title');
  const statusEl = document.getElementById('catalog-modal-status');
  const specSection = document.getElementById('catalog-modal-spec-section');
  const specTabs = document.getElementById('catalog-modal-spec-tabs');
  if (appidEl) appidEl.textContent = String(item.appid);
  if (titleEl) titleEl.textContent = item.title;
  if (statusEl) statusEl.textContent = item.premium ? 'PREMIUM' : 'STANDARD';
  renderCatalogModalImage(item);

  if (state !== 'ready') {
    renderCatalogGenres([]);
    if (specSection) specSection.hidden = false;
    if (specTabs) specTabs.style.display = 'none';
    renderCatalogSpecContent(
      'catalog-modal-minimum',
      '',
      state === 'loading' ? 'Memuat detail game...' : 'Detail game belum tersedia. Coba lagi nanti.'
    );
    setCatalogSpecTab('minimum');
    return;
  }

  renderCatalogGenres(item.genres);
  const hasMinimum = hasMeaningfulHtml(item.specification.minimum);
  const hasRecommended = hasMeaningfulHtml(item.specification.recommended);
  const hasAnySpec = hasMinimum || hasRecommended;
  if (specSection) specSection.hidden = !hasAnySpec;
  if (!hasAnySpec) return;
  if (specTabs) specTabs.style.display = hasMinimum && hasRecommended ? '' : 'none';
  renderCatalogSpecContent('catalog-modal-minimum', item.specification.minimum, 'Specification minimum belum tersedia.');
  renderCatalogSpecContent('catalog-modal-recommended', item.specification.recommended, 'Specification recommended belum tersedia.');
  setCatalogSpecTab(hasMinimum ? 'minimum' : 'recommended');
}

async function openCatalogModal(appid, triggerCard = null) {
  const item = getCatalogItemByAppid(appid);
  if (!item) return;
  const requestGeneration = ++catalogModalRequestGeneration;
  if (triggerCard) lastFocusedCatalogCard = triggerCard;
  activeCatalogModalAppId = appid;

  const modal = createCatalogModal();
  clearTimeout(catalogModalCloseTimer);
  catalogModalCloseTimer = null;
  modal.classList.remove('is-closing');
  const backdrop = document.getElementById('catalog-modal-backdrop');
  const scrollFade = document.getElementById('catalog-modal-scroll-fade');
  const closeButton = modal.querySelector('.catalog-modal__close');
  populateCatalogModal(item, 'loading');

  if (backdrop) backdrop.classList.add('is-active');
  modal.classList.add('is-active');
  modal.setAttribute('aria-hidden', 'false');
  modal.scrollTop = 0;
  if (scrollFade && window.innerWidth < 768) scrollFade.classList.remove('is-hidden');
  if (!document.body.classList.contains('body--modal-open')) {
    bodyOverflowBeforeModal = document.body.style.overflow;
  }
  document.body.style.overflow = 'hidden';
  document.body.classList.add('body--modal-open');
  requestAnimationFrame(() => (closeButton || modal).focus());

  try {
    const detail = NexaCatalogData.normalizeApiDetail(await fetchGameDetail(appid));
    if (!detail) throw new Error('Invalid game detail response');
    if (requestGeneration !== catalogModalRequestGeneration || activeCatalogModalAppId !== appid) return;
    populateCatalogModal(detail);
  } catch (error) {
    if (requestGeneration !== catalogModalRequestGeneration || activeCatalogModalAppId !== appid) return;
    console.error(`Failed to load API detail for AppID ${appid}`, error);
    populateCatalogModal(item, 'error');
  }
}

function closeCatalogModal() {
  catalogModalRequestGeneration += 1;

  const modal = document.getElementById('catalog-modal');
  const backdrop = document.getElementById('catalog-modal-backdrop');
  const scrollFade = document.getElementById('catalog-modal-scroll-fade');
  if (!modal) return;

  activeCatalogModalAppId = null;
  clearTimeout(catalogModalCloseTimer);
  catalogModalCloseTimer = null;

  // Hide scroll fade
  if (scrollFade) {
    scrollFade.classList.add('is-hidden');
  }

  // Desktop/Tablet: add closing animation class
  if (window.innerWidth >= 768) {
    modal.classList.add('is-closing');
    modal.classList.remove('is-active');
    if (backdrop) {
      backdrop.classList.remove('is-active');
    }

    catalogModalCloseTimer = setTimeout(() => {
      catalogModalCloseTimer = null;
      modal.classList.remove('is-closing');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = bodyOverflowBeforeModal;
      bodyOverflowBeforeModal = null;
      document.body.classList.remove('body--modal-open');
      if (lastFocusedCatalogCard && typeof lastFocusedCatalogCard.focus === 'function') {
        lastFocusedCatalogCard.focus();
      }
    }, 200);
  } else {
    // Mobile: slide down animation handled by CSS transition
    modal.classList.remove('is-active');
    if (backdrop) {
      backdrop.classList.remove('is-active');
    }
    modal.setAttribute('aria-hidden', 'true');

    catalogModalCloseTimer = setTimeout(() => {
      catalogModalCloseTimer = null;
      document.body.style.overflow = bodyOverflowBeforeModal;
      bodyOverflowBeforeModal = null;
      document.body.classList.remove('body--modal-open');
      if (lastFocusedCatalogCard && typeof lastFocusedCatalogCard.focus === 'function') {
        lastFocusedCatalogCard.focus();
      }
    }, 300);
  }
}

function renderCatalogLoading() {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="text-body" style="grid-column: 1 / -1; text-align: center;">Memuat katalog game...</p>';
}

function renderCatalogError() {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="text-body" style="grid-column: 1 / -1; text-align: center;">Katalog game gagal dimuat. Coba lagi nanti.</p>';
  setLoadMoreState();
}

function setLoadMoreState() {
  const button = document.getElementById('load-more-btn');
  if (!button) return;
  button.disabled = catalogLoading;
  button.style.display = catalogItems.length < catalogTotal ? '' : 'none';
}

function renderCatalog() {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;

  if (catalogItems.length === 0) {
    grid.innerHTML = `
      <div class="catalog-empty-state" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--text-tertiary)" stroke-width="1.5" fill="none" style="margin-bottom: 16px;">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">Game Tidak Ditemukan</h3>
        <p style="font-size: 14px; color: var(--text-secondary);">Coba sesuaikan kata kunci atau gunakan AppID Steam untuk hasil yang lebih akurat.</p>
      </div>
    `;
    setLoadMoreState();
    refreshCursorTargets();
    return;
  }

  grid.innerHTML = catalogItems.map(game =>
    createGameCardHTML(safeCardData(game), { showRank: false, interactive: true })
  ).join('');
  setLoadMoreState();
  refreshCursorTargets();

  const cards = grid.querySelectorAll('.game-card');
  gsap.fromTo(cards, {
    opacity: 0,
    y: 20,
    scale: 0.97,
  }, {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: isMobile ? 0.35 : 0.5,
    stagger: isMobile ? 0.03 : 0.04,
    ease: 'power3.out',
    onComplete: () => {
      gsap.set(cards, { clearProps: 'transform,opacity' });
    },
  });
}

function initCatalogControls() {
  const tabs = document.querySelectorAll('.filter-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('filter-tab--active'));
      tab.classList.add('filter-tab--active');
      currentFilter = tab.dataset.filter;
      loadCatalogPage(true);
    });
  });

  const searchInput = document.getElementById('catalog-search');
  if (searchInput) {
    let debounceTimer;
    let lastValue = searchInput.value;
    searchInput.addEventListener('input', () => {
      if (searchInput.value === lastValue) return;
      lastValue = searchInput.value;
      
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadCatalogPage(true), 300);
    });
  }

  const navSearch = document.getElementById('nav-search');
  if (navSearch && searchInput) {
    let navLastValue = navSearch.value;
    navSearch.addEventListener('input', () => {
      if (navSearch.value === navLastValue) return;
      navLastValue = navSearch.value;
      
      searchInput.value = navSearch.value;
      searchInput.dispatchEvent(new Event('input'));

      const catalogSection = document.getElementById('catalog');
      if (catalogSection) {
        const topPos = catalogSection.getBoundingClientRect().top + window.pageYOffset - 100;
        window.scrollTo({ top: topPos, behavior: 'smooth' });
      }
    });
  }

  const loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => loadCatalogPage(false));
  }

  const grid = document.getElementById('catalog-grid');
  if (grid) {
    grid.addEventListener('click', (event) => {
      const card = event.target.closest('.game-card');
      if (!card) return;

      const appid = Number(card.getAttribute('data-game-id'));
      if (!Number.isFinite(appid)) return;
      openCatalogModal(appid, card);
    });

    grid.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;

      const card = event.target.closest('.game-card[data-interactive="true"]');
      if (!card) return;

      event.preventDefault();
      const appid = Number(card.getAttribute('data-game-id'));
      if (!Number.isFinite(appid)) return;
      openCatalogModal(appid, card);
    });
  }

  const trendingGrid = document.getElementById('trending-grid');
  if (trendingGrid) {
    trendingGrid.addEventListener('click', (event) => {
      const card = event.target.closest('.game-card');
      if (!card) return;

      const appid = Number(card.getAttribute('data-game-id'));
      if (!Number.isFinite(appid)) return;
      openCatalogModal(appid, card);
    });

    trendingGrid.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;

      const card = event.target.closest('.game-card[data-interactive="true"]');
      if (!card) return;

      event.preventDefault();
      const appid = Number(card.getAttribute('data-game-id'));
      if (!Number.isFinite(appid)) return;
      openCatalogModal(appid, card);
    });
  }
}


/* ————————————————————————————————————————
   6. PUBLISHER MARQUEE
   ———————————————————————————————————————— */

function updateHeroCapsulesImages() {
  const container = document.getElementById('hero-capsules');
  if (!container) return;

  const catalogMap = new Map();
  trendingGames.forEach(item => catalogMap.set(item.appid, item));

  const capsules = container.querySelectorAll('.hero__capsule');
  capsules.forEach(capsule => {
    const appid = Number(capsule.dataset.heroAppid);
    if (!appid) return;
    const game = catalogMap.get(appid);
    if (game && game.cover_url && game.cover_url !== 'NO CONTENT') {
      capsule.style.backgroundImage = `url('${game.cover_url}')`;
    }
  });
}

/* ————————————————————————————————————————
   8. SCROLL SPY
   ———————————————————————————————————————— */
function initScrollSpy() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.navbar__nav .navbar__link');

  if (!sections.length || !navLinks.length) return;

  const observerOptions = {
    root: null,
    rootMargin: '-30% 0px -60% 0px',
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const currentId = entry.target.getAttribute('id');
        
        navLinks.forEach(link => {
          link.classList.remove('navbar__link--active');
          if (link.getAttribute('href') === `#${currentId}`) {
            link.classList.add('navbar__link--active');
          }
        });
      }
    });
  }, observerOptions);

  sections.forEach(section => observer.observe(section));
}

function initMarquee() {
  const track = document.getElementById('marquee-track');
  if (!track || !Array.isArray(PUBLISHERS)) return;

  const publisherItems = PUBLISHERS.map(p =>
    `<span class="marquee__item">${p}</span>`
  ).join('');

  track.innerHTML = publisherItems + publisherItems + publisherItems;
}


/* ————————————————————————————————————————
   7. PAGE INITIALIZATION
   ———————————————————————————————————————— */

document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(async () => {
    initHeroAnimation();
    initHeroCapsules();
    initCatalogControls();
    initMarquee();

    const hideGlobalLoader = () => {
      const loader = document.getElementById('global-loader');
      if (loader) {
        loader.classList.add('global-loader--hidden');
        setTimeout(() => loader.remove(), 600);
      }
    };

    try {
      await loadCatalogData();
      hideGlobalLoader();
    } catch (error) {
      console.error(error);
      const grid = document.getElementById('catalog-grid');
      if (grid) {
        grid.innerHTML = '<p class="text-body">Katalog game gagal dimuat.</p>';
      }
      hideGlobalLoader();
    }

    initScrollReveals();
    initCounters();
    initScrollSpy();
    refreshCursorTargets();
  });
});
