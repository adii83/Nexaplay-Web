/* ============================================================
   SHOWCASE.JS — NexaPlay Showcase Page Logic
   Hero entrance · FAQ accordion · Scroll reveals
   ============================================================ */

/* ──────────────────────────────────────
   1. SHOWCASE HERO ENTRANCE
   ────────────────────────────────────── */

function initShowcaseHero() {
  const heroElements = document.querySelectorAll('.showcase-anim');

  gsap.set(heroElements, { opacity: 0, y: 50 });

  const tl = gsap.timeline({ delay: 0.3 });

  heroElements.forEach((el, i) => {
    tl.to(el, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: 'power3.out',
    }, i * 0.18);
  });
}


/* ──────────────────────────────────────
   2. FAQ ACCORDION
   ────────────────────────────────────── */

function initFAQ() {
  const container = document.getElementById('faq-accordion');
  if (!container) return;

  // Render FAQ items from data
  container.innerHTML = FAQ_DATA.map((item, index) => `
    <div class="accordion__item" data-faq-index="${index}">
      <button class="accordion__header" aria-expanded="false">
        <span>${item.question}</span>
        <svg class="accordion__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
      </button>
      <div class="accordion__body">
        <div class="accordion__body-inner">
          ${item.answer}
        </div>
      </div>
    </div>
  `).join('');

  // Accordion click logic
  const items = container.querySelectorAll('.accordion__item');

  items.forEach(item => {
    const header = item.querySelector('.accordion__header');
    const body = item.querySelector('.accordion__body');
    const bodyInner = item.querySelector('.accordion__body-inner');

    header.addEventListener('click', () => {
      const isOpen = item.classList.contains('active');

      // Close all other items
      items.forEach(otherItem => {
        if (otherItem !== item && otherItem.classList.contains('active')) {
          otherItem.classList.remove('active');
          otherItem.querySelector('.accordion__header').setAttribute('aria-expanded', 'false');
          otherItem.querySelector('.accordion__body').style.maxHeight = '0';
        }
      });

      // Toggle current item
      if (isOpen) {
        item.classList.remove('active');
        header.setAttribute('aria-expanded', 'false');
        body.style.maxHeight = '0';
      } else {
        item.classList.add('active');
        header.setAttribute('aria-expanded', 'true');
        body.style.maxHeight = bodyInner.scrollHeight + 24 + 'px';
      }
    });
  });
}


/* ──────────────────────────────────────
   3. SMOOTH SCROLL TO PRICING (anchor)
   ────────────────────────────────────── */

function initSmoothAnchors() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const topPos = target.getBoundingClientRect().top + window.pageYOffset - 40;
        window.scrollTo({ top: topPos, behavior: 'smooth' });
      }
    });
  });
}


/* ──────────────────────────────────────
   4. PRICING CARD HOVER EFFECT
   ────────────────────────────────────── */

function initPricingEffects() {
  const cards = document.querySelectorAll('.pricing-card');

  cards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      gsap.to(card, {
        borderColor: 'rgba(255, 255, 255, 0.3)',
        duration: 0.3,
        ease: 'power2.out',
      });
    });

    card.addEventListener('mouseleave', () => {
      const isPremium = card.classList.contains('pricing-card--premium');
      gsap.to(card, {
        borderColor: isPremium ? 'rgba(255, 255, 255, 0.3)' : 'rgba(46, 46, 46, 1)',
        duration: 0.3,
        ease: 'power2.out',
      });
    });
  });
}


/* ──────────────────────────────────────
   5. PAGE INITIALIZATION
   ────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => {
    // Hero entrance
    initShowcaseHero();

    // FAQ
    initFAQ();

    // Anchor scrolling
    initSmoothAnchors();

    // Pricing hover
    initPricingEffects();

    // Scroll reveals (after FAQ is rendered)
    initScrollReveals();

    // Refresh cursor targets
    refreshCursorTargets();
  });
});
