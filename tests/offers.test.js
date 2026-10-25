const test = require('node:test');
const assert = require('node:assert/strict');
const offers = require('../js/offers.js');

const start = Date.parse('2026-10-24T17:00:00Z'); // 25 October, midnight WIB.
const atDay = day => new Date(start + day * 86400000);

test('starts at 200 with a six-month Premium membership on the first campaign day', () => {
  assert.deepEqual(offers.getPremiumPromoState(atDay(0)), {
    total: 200, remaining: 200, daysElapsed: 0, expired: false, membershipMonths: 6,
  });
});

test('quota changes at midnight WIB, not UTC or the visitor local timezone', () => {
  const before = offers.getPremiumPromoState(new Date('2026-10-25T16:59:59.999Z'));
  const after = offers.getPremiumPromoState(new Date('2026-10-25T17:00:00.000Z'));
  assert.equal(before.remaining, 200);
  assert.ok(before.remaining - after.remaining >= 3);
  assert.ok(before.remaining - after.remaining <= 5);
  assert.deepEqual(after, offers.getPremiumPromoState(new Date('2026-10-26T00:00:00+07:00')));
});

test('visitors and reloads see an identical daily allocation, with no countdown per visit', () => {
  const first = offers.getPremiumPromoState(new Date('2026-11-05T01:00:00Z'));
  const second = offers.getPremiumPromoState(new Date('2026-11-05T12:59:59Z'));
  assert.deepEqual(first, second);
  delete require.cache[require.resolve('../js/offers.js')];
  const reloaded = require('../js/offers.js');
  assert.deepEqual(first, reloaded.getPremiumPromoState(new Date('2026-11-05T01:00:00Z')));
});

test('falls by 3–5 each day, switches Premium to one month at zero, and never resets', () => {
  let previous = offers.getPremiumPromoState(atDay(0));
  const reductions = new Set();
  let exhaustedDay;
  for (let day = 1; day <= 200; day += 1) {
    const current = offers.getPremiumPromoState(atDay(day));
    assert.ok(current.remaining >= 0 && current.remaining <= previous.remaining);
    if (current.remaining > 0) {
      const change = previous.remaining - current.remaining;
      assert.ok(change >= 3 && change <= 5);
      assert.equal(current.membershipMonths, 6);
      reductions.add(change);
    } else {
      exhaustedDay ??= day;
      assert.equal(current.membershipMonths, 1);
      assert.equal(current.expired, true);
    }
    previous = current;
  }
  assert.deepEqual([...reductions].sort(), [3, 4, 5]);
  assert.ok(exhaustedDay >= 40 && exhaustedDay <= 67);
  assert.equal(offers.getPremiumPromoState(new Date('2070-01-01')).remaining, 0);
});

test('dates before the campaign do not create more than 200 slots', () => {
  assert.equal(offers.getPremiumPromoState(atDay(-20)).remaining, 200);
});
