/* ============================================================
   APP.JS — NexaPlay Shared Application Logic
   GSAP setup · Navbar · Custom cursor · Scroll reveals · Utilities
   Mobile-optimized animations
   ============================================================ */

/* ── Global device detection ── */
const _isMobileDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const _isSmallScreen = window.innerWidth < 768;

/* ──────────────────────────────────────
   1. NAVBAR SCROLL BEHAVIOR
   ────────────────────────────────────── */

function initNavbar() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  ScrollTrigger.create({
    start: 'top -80',
    end: 99999,
    onUpdate: (self) => {
      if (self.direction === 1 || self.progress > 0) {
        navbar.classList.add('navbar--scrolled');
      }
      if (self.progress === 0) {
        navbar.classList.remove('navbar--scrolled');
      }
    },
  });

  // Mobile menu toggle
  const menuToggle = document.querySelector('.navbar__menu-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', () => {
      menuToggle.classList.toggle('active');
      mobileNav.classList.toggle('active');
      document.body.style.overflow = mobileNav.classList.contains('active') ? 'hidden' : '';
    });

    // Close on link click
    mobileNav.querySelectorAll('.mobile-nav__link').forEach(link => {
      link.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        mobileNav.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
  }
}


/* ──────────────────────────────────────
   3. CUSTOM CURSOR
   ────────────────────────────────────── */

function initCustomCursor() {
  // Skip on touch devices
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

  const cursor = document.getElementById('custom-cursor');
  const cursorDot = document.getElementById('custom-cursor-dot');
  if (!cursor || !cursorDot) return;

  let mouseX = -100, mouseY = -100;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  // Smooth cursor follow with GSAP
  gsap.ticker.add(() => {
    gsap.to(cursor, {
      x: mouseX,
      y: mouseY,
      duration: 0.5,
      ease: 'power3.out',
    });
    gsap.to(cursorDot, {
      x: mouseX,
      y: mouseY,
      duration: 0.1,
      ease: 'power3.out',
    });
  });

  // Hover state for interactive elements
  const hoverTargets = document.querySelectorAll('a, button, .game-card, .filter-tab, .accordion__header, input, .video-player');

  hoverTargets.forEach(el => {
    el.addEventListener('mouseenter', () => cursor.classList.add('cursor--hover'));
    el.addEventListener('mouseleave', () => cursor.classList.remove('cursor--hover'));
  });

  // Hide when mouse leaves window
  document.addEventListener('mouseleave', () => {
    gsap.to([cursor, cursorDot], { opacity: 0, duration: 0.3 });
  });
  document.addEventListener('mouseenter', () => {
    gsap.to([cursor, cursorDot], { opacity: 1, duration: 0.3 });
  });
}

// Re-init cursor hover targets (called after dynamic content is added)
function refreshCursorTargets() {
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;
  const cursor = document.getElementById('custom-cursor');
  if (!cursor) return;

  const hoverTargets = document.querySelectorAll('a, button, .game-card, .filter-tab, .accordion__header, input, .video-player');
  hoverTargets.forEach(el => {
    el.removeEventListener('mouseenter', cursorEnterHandler);
    el.removeEventListener('mouseleave', cursorLeaveHandler);
    el.addEventListener('mouseenter', cursorEnterHandler);
    el.addEventListener('mouseleave', cursorLeaveHandler);
  });
}

function cursorEnterHandler() {
  const cursor = document.getElementById('custom-cursor');
  if (cursor) cursor.classList.add('cursor--hover');
}

function cursorLeaveHandler() {
  const cursor = document.getElementById('custom-cursor');
  if (cursor) cursor.classList.remove('cursor--hover');
}


/* ──────────────────────────────────────
   4. SCROLL REVEAL UTILITY
   Mobile: shorter distance, faster duration, earlier trigger
   ────────────────────────────────────── */

function initScrollReveals() {
  const revealElements = document.querySelectorAll('.reveal');
  const yDist = _isSmallScreen ? 25 : 50;
  const dur = _isSmallScreen ? 0.6 : 0.9;

  revealElements.forEach((el, i) => {
    gsap.fromTo(el,
      { opacity: 0, y: yDist },
      {
        opacity: 1,
        y: 0,
        duration: dur,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: _isSmallScreen ? 'top 95%' : 'top 88%',
          toggleActions: 'play none none none',
        },
      }
    );
  });
}


/* ──────────────────────────────────────
   5. ANIMATED COUNTER
   Mobile: faster count, earlier trigger
   ────────────────────────────────────── */

function initCounters() {
  const counters = document.querySelectorAll('[data-counter]');
  const countDuration = _isSmallScreen ? 1.4 : 2;

  counters.forEach(counter => {
    const target = parseFloat(counter.dataset.counter);
    const suffix = counter.dataset.counterSuffix || '';
    const decimals = counter.dataset.counterDecimals ? parseInt(counter.dataset.counterDecimals) : 0;

    const obj = { val: 0 };

    ScrollTrigger.create({
      trigger: counter,
      start: _isSmallScreen ? 'top 95%' : 'top 90%',
      once: true,
      onEnter: () => {
        gsap.to(obj, {
          val: target,
          duration: countDuration,
          ease: 'power2.out',
          onUpdate: () => {
            counter.textContent = decimals > 0
              ? obj.val.toFixed(decimals) + suffix
              : Math.floor(obj.val).toLocaleString() + suffix;
          },
        });
      },
    });
  });
}


/* ──────────────────────────────────────
   6. CARD PLACEHOLDER GENERATOR
   ────────────────────────────────────── */

/**
 * Generates a unique monochrome gradient for a game card placeholder.
 * Uses the game ID to create variation.
 */
function generateCardPlaceholder(gameId) {
  // Create unique angles and shades based on game ID
  const seed = gameId * 137.508;  // Golden angle in degrees
  const angle = Math.floor(seed % 360);
  const shade1 = 15 + (gameId * 7) % 20;   // Range: 15-35
  const shade2 = 25 + (gameId * 11) % 25;  // Range: 25-50
  const shade3 = 10 + (gameId * 5) % 15;   // Range: 10-25

  // Create abstract geometric patterns with gradients
  const patterns = [
    // Diagonal split
    `linear-gradient(${angle}deg, hsl(0,0%,${shade1}%) 0%, hsl(0,0%,${shade2}%) 40%, hsl(0,0%,${shade3}%) 100%)`,
    // Radial spotlight
    `radial-gradient(ellipse at ${30 + (gameId * 13) % 40}% ${20 + (gameId * 17) % 60}%, hsl(0,0%,${shade2}%) 0%, hsl(0,0%,${shade1}%) 50%, hsl(0,0%,${shade3}%) 100%)`,
    // Multi-angle
    `linear-gradient(${angle}deg, hsl(0,0%,${shade3}%) 0%, hsl(0,0%,${shade2}%) 50%, hsl(0,0%,${shade1}%) 100%)`,
    // Corner radial
    `radial-gradient(circle at ${(gameId % 2) * 100}% ${(gameId % 3) * 50}%, hsl(0,0%,${shade2 + 5}%) 0%, hsl(0,0%,${shade1}%) 60%, hsl(0,0%,${shade3}%) 100%)`,
  ];

  const patternIndex = gameId % patterns.length;
  return patterns[patternIndex];
}


/* ──────────────────────────────────────
   7. GAME CARD HTML GENERATOR
   ────────────────────────────────────── */

/**
 * Creates HTML string for a game card.
 * @param {Object} game — game data object
 * @param {Object} options — { showRank: boolean }
 */
function createGameCardHTML(game, options = {}) {
  const { showRank = false, interactive = false } = options;
  const gameId = Number(game.appid ?? game.id ?? 0);
  const gradient = generateCardPlaceholder(gameId || 1);
  const title = game.title || game.name || 'Untitled Game';
  const appid = game.appid ?? game.id ?? '';
  const isPremium = typeof game.premium === 'boolean'
    ? game.premium
    : game.category === 'Premium';
  const badgeLabel = isPremium ? 'Premium' : 'Standard';
  const coverUrl = typeof game.cover_url === 'string' && game.cover_url.trim() && game.cover_url !== 'NO CONTENT'
    ? game.cover_url.trim()
    : '';

  let rankHTML = '';
  if (showRank && game.rank) {
    rankHTML = `<span class="game-card__rank">#${game.rank}</span>`;
  }

  const mediaHTML = coverUrl
    ? `<img class="game-card__image" src="${coverUrl}" alt="${title}" loading="lazy" decoding="async">`
    : `<div class="game-card__placeholder" style="background: ${gradient};"></div>`;

  const interactivityAttrs = interactive
    ? ` role="button" tabindex="0" aria-label="Lihat detail ${title}" data-interactive="true"`
    : '';

  return `
    <article class="game-card${interactive ? ' game-card--interactive' : ''}" data-game-id="${appid}" data-category="${badgeLabel}"${interactivityAttrs}>
      ${mediaHTML}
      <div class="game-card__gradient-overlay"></div>
      ${rankHTML}
      <span class="game-card__badge">${badgeLabel}</span>
      <div class="game-card__content">
        <span class="game-card__appid">${appid}</span>
        <h3 class="game-card__title">${title}</h3>
      </div>
    </article>
  `;
}


/* ──────────────────────────────────────
   8. INITIALIZATION
   ────────────────────────────────────── */

function initApp() {
  // Register GSAP plugins
  gsap.registerPlugin(ScrollTrigger);

  // Init core systems
  initNavbar();
  initCustomCursor();

  // These are called after page-specific content is rendered
  // initScrollReveals() and initCounters() are called from page-specific JS
}

// Run on DOM ready
document.addEventListener('DOMContentLoaded', initApp);
