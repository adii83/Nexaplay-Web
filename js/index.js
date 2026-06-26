/* ============================================================
   INDEX.JS — NexaPlay Landing Page Logic
   Hero animation · Parallax · Catalog priority ordering · 20-card pagination
   ============================================================ */

/* —— Device detection helper —— */
const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const isMobile = window.innerWidth < 768;

const PRIORITY_APPIDS_URL = 'appid.json';
const POPULAR_APPIDS_URL = 'appid_populer.json';
const CATALOG_URL = './web_catalog_builder/output/search_index.json';
const CATALOG_BATCH_SIZE = 20;

let currentFilter = 'all';
let visibleCatalogCount = CATALOG_BATCH_SIZE;
let catalogData = [];
let orderedCatalogData = [];
let activeCatalogModalAppId = null;
let lastFocusedCatalogCard = null;
let bodyOverflowBeforeModal = '';
let activeCatalogSpecTab = 'minimum';

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
  if (!grid || !window.popularAppids || !catalogData) return;

  const catalogMap = new Map();
  catalogData.forEach(item => catalogMap.set(item.appid, item));

  const trendingGames = window.popularAppids
    .map((appid, index) => {
      const game = catalogMap.get(Number(appid));
      if (game) {
        return { ...game, rank: index + 1, trending: true };
      }
      return null;
    })
    .filter(Boolean);

  grid.innerHTML = trendingGames.map(game =>
    createGameCardHTML(game, { showRank: true, interactive: true })
  ).join('');
}


/* ————————————————————————————————————————
   4. CATALOG DATA LOADING
   ———————————————————————————————————————— */

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

function normalizeCatalogItem(item) {
  if (!item || !Array.isArray(item)) return null;

  // item format: [appid, title, premium, cover_data, chunk_index]
  const appid = Number(item[0]);
  const title = typeof item[1] === 'string' ? item[1].trim() : '';

  if (!Number.isFinite(appid) || !title) return null;

  const premium = item[2] === 1;
  const coverData = item[3];
  
  let cover_url = '';
  if (coverData) {
    if (coverData.startsWith("http")) {
        cover_url = coverData;
    } else {
        cover_url = `https://shared.steamstatic.com/store_item_assets/steam/apps/${coverData}`;
    }
  }

  const chunk = typeof item[4] === 'number' ? item[4] : null;

  return {
    appid,
    title,
    premium,
    cover_url,
    chunk,
    _fullDataLoaded: false,
    publishers: [],
    genres: [],
    specification: { minimum: '', recommended: '' },
  };
}

function prioritizeCatalogItems(priorityAppids, allItems) {
  const catalogMap = new Map();
  allItems.forEach(item => {
    catalogMap.set(item.appid, item);
  });

  const used = new Set();
  const priorityItems = [];

  priorityAppids.forEach(appid => {
    const numericId = Number(appid);
    if (!Number.isFinite(numericId) || used.has(numericId)) return;

    const matchedItem = catalogMap.get(numericId);
    if (!matchedItem) return;

    priorityItems.push(matchedItem);
    used.add(numericId);
  });

  const remainingItems = allItems.filter(item => !used.has(item.appid));
  return priorityItems.concat(remainingItems);
}

async function loadCatalogData() {
  const [priorityAppidsRaw, catalogRaw, popularAppidsText] = await Promise.all([
    fetchJson(PRIORITY_APPIDS_URL),
    fetchJson(CATALOG_URL),
    fetch(POPULAR_APPIDS_URL).then(res => res.text()).catch(() => "[]")
  ]);

  const priorityAppids = Array.isArray(priorityAppidsRaw) ? priorityAppidsRaw : [];
  const catalogItems = Array.isArray(catalogRaw)
    ? catalogRaw.map(normalizeCatalogItem).filter(Boolean)
    : [];

  let popularAppidsRaw = [];
  try {
    // Bersihkan trailing comma yang tidak valid di JSON sebelum diparse
    const cleanJsonText = popularAppidsText.replace(/,\s*\]/g, ']');
    popularAppidsRaw = JSON.parse(cleanJsonText);
  } catch (e) {
    console.warn("Failed to parse appid_populer.json", e);
  }

  catalogData = catalogItems;
  orderedCatalogData = prioritizeCatalogItems(priorityAppids, catalogItems);
  
  // Ambil maksimal 10 game populer
  window.popularAppids = Array.isArray(popularAppidsRaw) ? popularAppidsRaw.slice(0, 10) : [];
}


/* ————————————————————————————————————————
   5. CATALOG GRID + FILTERS + SEARCH
   ———————————————————————————————————————— */

function normalizeSearchText(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/['"’‘]/g, '') // Hapus tanda kutip (assassin's -> assassins)
    .replace(/[™®©]/g, '')  // Hapus trademark dll
    .replace(/[^a-z0-9\s]/g, ' ') // Ganti karakter aneh lain dengan spasi
    .replace(/\s+/g, ' ') // Hindari spasi ganda
    .trim();
}

function getFilteredGames() {
  let filtered = [...orderedCatalogData];

  if (currentFilter !== 'all') {
    const wantsPremium = currentFilter === 'Premium';
    filtered = filtered.filter(game => game.premium === wantsPremium);
  }

  const searchInput = document.getElementById('catalog-search');
  if (searchInput && searchInput.value.trim()) {
    const rawQuery = searchInput.value.trim();
    const normalizedQuery = normalizeSearchText(rawQuery);
    
    filtered = filtered.filter(game => {
      const normalizedTitle = normalizeSearchText(game.title);
      return normalizedTitle.includes(normalizedQuery) || String(game.appid).includes(rawQuery);
    });
  }

  return filtered;
}

function updateCatalogCounter(total) {
  const counter = document.querySelector('.catalog__counter-number [data-counter]');
  if (!counter) return;

  counter.textContent = total.toLocaleString() + '+';
  counter.removeAttribute('data-counter');
}

function getCatalogItemByAppid(appid) {
  return orderedCatalogData.find(item => item.appid === appid) || null;
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
          <span class="catalog-modal__meta-separator" id="catalog-modal-separator">·</span>
          <span class="catalog-modal__publisher" id="catalog-modal-publisher"></span>
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

  // Create a temporary DOM element to parse the HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = specHtml;

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

  if (!hasMeaningfulHtml(specHtml)) {
    container.innerHTML = `<p class="catalog-modal__empty">${fallbackText}</p>`;
    return;
  }

  const items = parseSpecHtml(specHtml);

  if (items.length > 0) {
    container.innerHTML = `
      <ul class="catalog-modal__spec-list">
        ${items.map((item, idx) => `
          <li class="catalog-modal__spec-item">
            <span class="catalog-modal__spec-item-label">${item.label}</span>
            <span class="catalog-modal__spec-item-value">${item.value}</span>
          </li>
        `).join('')}
      </ul>
    `;
  } else {
    // Fallback: render raw HTML in spec-body container
    container.innerHTML = `<div class="catalog-modal__spec-body">${specHtml}</div>`;
  }
}

function renderCatalogModalImage(item) {
  const wrap = document.getElementById('catalog-modal-image-wrap');
  if (!wrap) return;

  if (item.cover_url && item.cover_url !== 'NO CONTENT') {
    wrap.innerHTML = `<img class="catalog-modal__image" src="${item.cover_url}" alt="${item.title}" loading="lazy" decoding="async">`;
    return;
  }

  const gradient = generateCardPlaceholder(item.appid || 1);
  wrap.innerHTML = `
    <div class="catalog-modal__placeholder" style="background:${gradient};">
      <span>NO CONTENT</span>
    </div>
  `;
}

function renderCatalogGenres(genres) {
  const section = document.getElementById('catalog-modal-genres-section');
  const container = document.getElementById('catalog-modal-genres');
  if (!section || !container) return;

  if (!Array.isArray(genres) || genres.length === 0) {
    section.hidden = true;
    container.innerHTML = '';
    return;
  }

  section.hidden = false;
  container.innerHTML = genres
    .map(genre => `<span class="catalog-modal__genre-chip">${genre}</span>`)
    .join('');
}

async function openCatalogModal(appid, triggerCard = null) {
  const item = getCatalogItemByAppid(appid);
  if (!item) return;

  if (triggerCard) {
    lastFocusedCatalogCard = triggerCard;
  }

  // Fetch full data from chunk if it hasn't been loaded yet
  if (!item._fullDataLoaded && item.chunk) {
    try {
      const chunkUrl = `./web_catalog_builder/output/chunks/catalog-${String(item.chunk).padStart(4, '0')}.json`;
      const chunkData = await fetchJson(chunkUrl);
      const fullItemData = chunkData.find(g => Number(g.appid) === appid);
      if (fullItemData) {
        Object.assign(item, fullItemData);
        item._fullDataLoaded = true;
        // Normalize nested fields that might be raw from chunk
        item.publishers = Array.isArray(item.publishers) ? item.publishers : [];
        item.genres = Array.isArray(item.genres) ? item.genres : [];
        item.specification = item.specification && typeof item.specification === 'object'
          ? { 
              minimum: typeof item.specification.minimum === 'string' ? item.specification.minimum : '', 
              recommended: typeof item.specification.recommended === 'string' ? item.specification.recommended : '' 
            }
          : { minimum: '', recommended: '' };
      }
    } catch (e) {
      console.error('Failed to load full chunk data', e);
    }
  }

  activeCatalogModalAppId = appid;
  const modal = createCatalogModal();
  const backdrop = document.getElementById('catalog-modal-backdrop');
  const scrollFade = document.getElementById('catalog-modal-scroll-fade');
  const closeButton = modal.querySelector('.catalog-modal__close');
  const appidEl = document.getElementById('catalog-modal-appid');
  const titleEl = document.getElementById('catalog-modal-title');
  const statusEl = document.getElementById('catalog-modal-status');
  const publisherEl = document.getElementById('catalog-modal-publisher');
  const separatorEl = document.getElementById('catalog-modal-separator');
  const specSection = document.getElementById('catalog-modal-spec-section');
  const specTabs = document.getElementById('catalog-modal-spec-tabs');

  // Populate header
  if (appidEl) appidEl.textContent = String(item.appid);
  if (titleEl) titleEl.textContent = item.title;
  if (statusEl) statusEl.textContent = item.premium ? 'PREMIUM' : 'STANDARD';

  // Publisher handling
  const hasPublisher = item.publishers.length > 0;
  if (publisherEl) {
    publisherEl.textContent = hasPublisher ? item.publishers.join(', ') : '';
    publisherEl.style.display = hasPublisher ? '' : 'none';
  }
  if (separatorEl) {
    separatorEl.style.display = hasPublisher ? '' : 'none';
  }

  // Image
  renderCatalogModalImage(item);

  // Genres
  renderCatalogGenres(item.genres);

  // Specification
  const hasMinimum = hasMeaningfulHtml(item.specification.minimum);
  const hasRecommended = hasMeaningfulHtml(item.specification.recommended);
  const hasAnySpec = hasMinimum || hasRecommended;

  if (specSection) {
    specSection.hidden = !hasAnySpec;
  }

  if (hasAnySpec) {
    // Toggle visibility: show only if both exist
    if (specTabs) {
      specTabs.style.display = (hasMinimum && hasRecommended) ? '' : 'none';
    }

    renderCatalogSpecContent(
      'catalog-modal-minimum',
      item.specification.minimum,
      'Specification minimum belum tersedia.'
    );
    renderCatalogSpecContent(
      'catalog-modal-recommended',
      item.specification.recommended,
      'Specification recommended belum tersedia.'
    );

    // Set active tab to whichever data exists
    if (hasMinimum) {
      setCatalogSpecTab('minimum');
    } else {
      setCatalogSpecTab('recommended');
    }
  }

  // Show modal
  if (backdrop) {
    backdrop.classList.add('is-active');
  }

  modal.classList.add('is-active');
  modal.setAttribute('aria-hidden', 'false');

  // Show scroll fade on mobile
  if (scrollFade && window.innerWidth < 768) {
    scrollFade.classList.remove('is-hidden');
    // Check if content is already fully visible (no scroll needed)
    requestAnimationFrame(() => {
      if (modal.scrollHeight <= modal.clientHeight) {
        scrollFade.classList.add('is-hidden');
      }
    });
  }

  // Scroll modal to top
  modal.scrollTop = 0;

  bodyOverflowBeforeModal = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.classList.add('body--modal-open');

  requestAnimationFrame(() => {
    if (closeButton) {
      closeButton.focus();
      return;
    }
    modal.focus();
  });
}

function closeCatalogModal() {
  const modal = document.getElementById('catalog-modal');
  const backdrop = document.getElementById('catalog-modal-backdrop');
  const scrollFade = document.getElementById('catalog-modal-scroll-fade');
  if (!modal) return;

  activeCatalogModalAppId = null;

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

    setTimeout(() => {
      modal.classList.remove('is-closing');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = bodyOverflowBeforeModal;
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

    setTimeout(() => {
      document.body.style.overflow = bodyOverflowBeforeModal;
      document.body.classList.remove('body--modal-open');
      if (lastFocusedCatalogCard && typeof lastFocusedCatalogCard.focus === 'function') {
        lastFocusedCatalogCard.focus();
      }
    }, 300);
  }
}

/**
 * Returns the current number of columns in the game grid
 * based on the viewport width (must match CSS breakpoints).
 */
function getGridColumnCount() {
  const w = window.innerWidth;
  if (w >= 1600) return 6;
  if (w >= 1280) return 5;
  if (w >= 1024) return 4;
  if (w >= 768)  return 3;
  return 2; // mobile default
}

function renderCatalog(resetPage = true) {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;

  if (resetPage) {
    visibleCatalogCount = CATALOG_BATCH_SIZE;
  }

  const filtered = getFilteredGames();
  const columns = getGridColumnCount();

  // Round visible count down to nearest multiple of columns
  // so the last row is always full
  let targetCount = Math.min(visibleCatalogCount, filtered.length);
  if (targetCount > 0 && targetCount < filtered.length) {
    targetCount = Math.floor(targetCount / columns) * columns;
    if (targetCount === 0) targetCount = Math.min(columns, filtered.length);
  }

  const visible = filtered.slice(0, targetCount);

  if (visible.length === 0) {
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
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    refreshCursorTargets();
    return;
  }

  grid.innerHTML = visible.map(game =>
    createGameCardHTML(game, { showRank: false, interactive: true })
  ).join('');

  const loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.style.display = visible.length < filtered.length ? '' : 'none';
  }

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
      renderCatalog(true);
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
      debounceTimer = setTimeout(() => renderCatalog(true), 300);
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
    loadMoreBtn.addEventListener('click', () => {
      visibleCatalogCount += CATALOG_BATCH_SIZE;
      renderCatalog(false);
    });
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
  if (!container || !catalogData) return;

  const catalogMap = new Map();
  catalogData.forEach(item => catalogMap.set(item.appid, item));

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
      updateCatalogCounter(orderedCatalogData.length);
      renderTrendingGames();
      updateHeroCapsulesImages();
      renderCatalog(true);
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
