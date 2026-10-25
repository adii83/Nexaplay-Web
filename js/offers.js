/* Shared package offer and calendar-based promotional allocation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NexaOffers = api;
  if (typeof document === 'undefined') return;

  function refresh() {
    const state = api.getPremiumPromoState();
    document.querySelectorAll('[data-premium-months]').forEach(element => {
      element.textContent = `${state.membershipMonths} bulan`;
    });
    document.querySelectorAll('[data-promo-remaining]').forEach(element => {
      element.textContent = String(state.remaining);
    });
    document.querySelectorAll('[data-promo-active]').forEach(element => {
      element.hidden = state.expired;
    });
    document.querySelectorAll('[data-promo-ended]').forEach(element => {
      element.hidden = !state.expired;
    });
    document.querySelectorAll('[data-promo-progress]').forEach(element => {
      element.max = state.total;
      element.value = state.remaining;
    });
    document.querySelectorAll('[data-premium-promo-label]').forEach(element => {
      element.textContent = state.expired ? 'Membership sudah termasuk' : 'Bonus membership selama promo';
    });
    document.querySelectorAll('.accordion__item.active .accordion__body').forEach(body => {
      const inner = body.querySelector('.accordion__body-inner');
      if (inner) body.style.maxHeight = `${inner.scrollHeight + 24}px`;
    });
    return state;
  }

  api.refresh = refresh;
  document.addEventListener('DOMContentLoaded', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  root.setInterval(refresh, 60000);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PREMIUM_PROMO = Object.freeze({
    total: 200,
    startDate: '2026-10-25',
    timeZone: 'Asia/Jakarta',
    seed: 'nexaplay-premium-6-months-2026-10',
  });

  function dayNumber(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) / 86400000;
  }

  function dailyReduction(day) {
    let hash = 2166136261;
    const key = `${PREMIUM_PROMO.seed}:${day}`;
    for (const character of key) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    }
    return 3 + hash % 3;
  }

  function getPremiumPromoState(now = new Date()) {
    const startDay = Date.parse(`${PREMIUM_PROMO.startDate}T00:00:00Z`) / 86400000;
    const daysElapsed = Math.max(0, dayNumber(now, PREMIUM_PROMO.timeZone) - startDay);
    let remaining = PREMIUM_PROMO.total;
    // The seeded sequence is shared across visitors, devices and reloads.
    for (let day = 1; day <= daysElapsed && remaining > 0; day += 1) {
      remaining = Math.max(0, remaining - dailyReduction(day));
    }
    return {
      total: PREMIUM_PROMO.total,
      remaining,
      daysElapsed,
      expired: remaining === 0,
      membershipMonths: remaining === 0 ? 1 : 6,
    };
  }

  return { PREMIUM_PROMO, getPremiumPromoState };
});
