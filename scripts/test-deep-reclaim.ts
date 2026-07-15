import assert from 'node:assert/strict';
import {
  DEEP_RECLAIM_EXPIRY_MS,
  DEEP_RECLAIM_GEOMETRY_V0,
  DEEP_RECLAIM_LEGACY_RULESET_ID,
  DEEP_RECLAIM_LEGACY_SELECTION_POLICY_ID,
  DEEP_RECLAIM_SELECTION_POLICY_ID,
  DEEP_RECLAIM_OI_MAX_AGE_MS,
  DEEP_RECLAIM_SLOT_MS,
  activeDeepReclaims,
  applyDeepReclaimArm,
  applyDeepReclaimTransition,
  armDeepReclaim,
  attachDeepReclaimOiEligibility,
  closed15mBars,
  deepReclaimOiDecision,
  deepReclaimOperationalScore,
  deepReclaimRankScore,
  detectDeepReclaim,
  detectDeepReclaimPriceCandidate,
  emptyDeepReclaimState,
  evaluateDeepReclaimPrice,
  evaluateDeepReclaimPriceWithRules,
  observeDeepReclaim,
  rankDeepReclaimCandidates,
  rankDeepReclaimOperationalCandidates,
  sanitizeDeepReclaimState,
  type DeepReclaim5mCandle,
  type DeepReclaimBar,
  type DeepReclaimOiObservation,
  type DeepReclaimPriceCandidate,
  type DeepReclaimWatch,
} from '../src/lib/deepReclaim';

let failures = 0;
let passes = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passes++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

const T0 = Math.floor(1_800_000_000_000 / DEEP_RECLAIM_SLOT_MS) * DEEP_RECLAIM_SLOT_MS;

function barAt(index: number, close: number, overrides: Partial<DeepReclaimBar> = {}): DeepReclaimBar {
  return {
    closeTs: T0 + (index + 1) * DEEP_RECLAIM_SLOT_MS,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    ...overrides,
  };
}

/** Frozen positive fixture: peak i75 -> trough i89 -> fresh EMA20 reclaim i99. */
function priceFixture(): DeepReclaimBar[] {
  const out: DeepReclaimBar[] = [];
  for (let i = 0; i < 100; i++) out.push(barAt(i, 100));
  out[75] = barAt(75, 104, { open: 101, high: 110, low: 100, close: 104 });
  const fall = [102, 101, 100, 99, 98, 97, 96, 96, 95, 95, 94.8, 94.5, 94.2];
  for (let j = 0; j < fall.length; j++) {
    const i = 76 + j;
    out[i] = barAt(i, fall[j], { high: fall[j] + 0.8, low: fall[j] - 0.8 });
  }
  out[89] = barAt(89, 94, { open: 94.5, high: 95, low: 92, close: 94 });
  const rebound = [94.4, 94.8, 95.2, 95.7, 96.2, 96.7, 97.2, 97.7, 94];
  for (let j = 0; j < rebound.length; j++) {
    const i = 90 + j;
    out[i] = barAt(i, rebound[j], { high: rebound[j] + 0.7, low: rebound[j] - 0.7 });
  }
  out[99] = barAt(99, 98.5, { open: 94, high: 99, low: 93.8, close: 98.5 });
  return out;
}

function requirePrice(bars = priceFixture(), sym = 'TEST'): DeepReclaimPriceCandidate {
  const result = evaluateDeepReclaimPrice(sym, bars);
  assert.equal(result.qualified, true, result.qualified ? undefined : `fixture rejected: ${result.reason}`);
  return result.candidate;
}

function passingOi(at: number, overrides: Partial<DeepReclaimOiObservation> = {}): DeepReclaimOiObservation {
  return { observedAt: at - 5 * 60_000, qty1h: 0.5, qty4h: 3, ...overrides };
}

function requireWatch(): DeepReclaimWatch {
  const price = requirePrice();
  const armed = armDeepReclaim(price, passingOi(price.setupTs));
  assert.ok(armed.candidate);
  return armed.candidate;
}

function observedBar(
  watch: DeepReclaimWatch,
  slots: number,
  close: number,
  overrides: Partial<DeepReclaimBar> = {},
): DeepReclaimBar {
  const pad = Math.max(0.01, watch.atr14 * 0.1);
  return {
    closeTs: watch.setupTs + slots * DEEP_RECLAIM_SLOT_MS,
    open: close,
    high: close + pad,
    low: close - pad,
    close,
    ...overrides,
  };
}

function candle5(time: number, close: number, overrides: Partial<DeepReclaim5mCandle> = {}): DeepReclaim5mCandle {
  return { time, open: close - 0.2, high: close + 0.5, low: close - 0.5, close, ...overrides };
}

test('closed15mBars builds UTC buckets from exactly three completed 5m opens', () => {
  const bucket = 1_800_000_000;
  const xs = [
    candle5(bucket, 100, { open: 99.5, high: 101, low: 99 }),
    candle5(bucket + 300, 102, { high: 103, low: 100 }),
    candle5(bucket + 600, 101, { high: 102.5, low: 100.5 }),
  ];
  const got = closed15mBars(xs.reverse(), (bucket + 900) * 1000);
  assert.deepEqual(got, [{ closeTs: (bucket + 900) * 1000, open: 99.5, high: 103, low: 99, close: 101 }]);
});

test('closed15mBars excludes a forming bucket even when all source rows are present', () => {
  const bucket = 1_800_000_000;
  const xs = [candle5(bucket, 100), candle5(bucket + 300, 101), candle5(bucket + 600, 102)];
  assert.deepEqual(closed15mBars(xs, (bucket + 899) * 1000), []);
});

test('closed15mBars drops incomplete, off-grid and conflicting-duplicate buckets', () => {
  const a = 1_800_000_000;
  const b = a + 900;
  const c = b + 900;
  const xs = [
    candle5(a, 100), candle5(a + 600, 100), // incomplete
    candle5(b, 100), candle5(b + 300, 100), candle5(b + 600, 100), candle5(b + 600, 101), // conflict
    candle5(c, 100), candle5(c + 300, 100), candle5(c + 600, 100), candle5(c + 600, 100), // identical duplicate
    candle5(c + 301, 999), // off-grid garbage
  ];
  const got = closed15mBars(xs, (c + 900) * 1000);
  assert.equal(got.length, 1);
  assert.equal(got[0].closeTs, (c + 900) * 1000);
});

test('price detector freezes causal drawdown, EMA/ATR/L0 and anti-chase geometry', () => {
  const bars = priceFixture();
  const before = structuredClone(bars);
  const c = requirePrice(bars, 'test');
  assert.deepEqual(bars, before, 'detector must not mutate its input');
  assert.equal(c.sym, 'TEST');
  assert.equal(c.barCount, 100);
  assert.equal(c.peakTs, bars[75].closeTs);
  assert.equal(c.peakHigh, 110);
  assert.equal(c.troughTs, bars[89].closeTs);
  assert.equal(c.troughLow, 92);
  assert.equal(c.troughAgeBars, 10);
  assert.ok(Math.abs(c.ddPct - 16.36363636) < 1e-6);
  assert.ok(c.pos24 <= 0.7);
  assert.ok(c.ret4hPct > 0 && c.ret4hPct <= 6);
  assert.ok(c.setupClose > c.ema20 && bars[98].close <= c.ema20Prev);
  assert.ok(c.ema20 > c.ema20Prev);
  assert.equal(c.bandLow, c.l0);
  assert.equal(c.bandHigh, c.l0 + 0.5 * c.atr14);
  assert.equal(c.invalidBelow, c.troughLow);
  assert.equal(c.missedAbove, c.l0 + 2 * c.atr14);
  assert.equal(c.expiresAt, c.setupTs + DEEP_RECLAIM_EXPIRY_MS);
  assert.ok(c.rankScore >= 0 && c.rankScore <= 100);
});

test('price detector requires at least 100 completed 15m bars', () => {
  assert.deepEqual(evaluateDeepReclaimPrice('TEST', priceFixture().slice(1)), {
    qualified: false,
    reason: 'insufficient-bars',
  });
});

test('price detector sorts input but rejects a gap or duplicate close timestamp', () => {
  const reversed = [...priceFixture()].reverse();
  assert.ok(detectDeepReclaimPriceCandidate('TEST', reversed));
  const gap = priceFixture();
  gap[50] = { ...gap[50], closeTs: gap[50].closeTs + 1 };
  assert.equal(evaluateDeepReclaimPrice('TEST', gap).qualified, false);
  const dup = priceFixture();
  dup[50] = { ...dup[50], closeTs: dup[49].closeTs };
  assert.deepEqual(evaluateDeepReclaimPrice('TEST', dup), { qualified: false, reason: 'invalid-bars' });
});

test('causal drawdown rejects a newer trough that is fewer than four bars old', () => {
  const bars = priceFixture();
  bars[97] = { ...bars[97], low: 91.5 };
  const got = evaluateDeepReclaimPrice('TEST', bars);
  assert.deepEqual(got, { qualified: false, reason: 'trough-age-out-of-range' });
});

test('causal drawdown age cap rejects an older maximum even when a newer smaller drawdown exists', () => {
  const bars = priceFixture();
  bars[5] = { ...bars[5], high: 112 };
  bars[10] = { ...bars[10], low: 90 };
  const got = evaluateDeepReclaimPrice('TEST', bars);
  assert.deepEqual(got, { qualified: false, reason: 'trough-age-out-of-range' });
});

test('drawdown must remain inside the frozen 6% to 20% inclusive range', () => {
  const shallow = priceFixture();
  shallow[75] = { ...shallow[75], high: 101 };
  shallow[89] = { ...shallow[89], low: 96 };
  assert.equal(evaluateDeepReclaimPrice('TEST', shallow).qualified, false);
  const deep = priceFixture();
  deep[89] = { ...deep[89], low: 85 };
  assert.deepEqual(evaluateDeepReclaimPrice('TEST', deep), { qualified: false, reason: 'drawdown-out-of-range' });
});

test('research geometry seam is default-equivalent and cannot mutate production v0', () => {
  const bars = priceFixture();
  const before = structuredClone(DEEP_RECLAIM_GEOMETRY_V0);
  assert.deepEqual(
    evaluateDeepReclaimPriceWithRules('TEST', bars, { ...DEEP_RECLAIM_GEOMETRY_V0 }),
    evaluateDeepReclaimPrice('TEST', bars),
  );
  assert.deepEqual(DEEP_RECLAIM_GEOMETRY_V0, before);
  assert.ok(Object.isFrozen(DEEP_RECLAIM_GEOMETRY_V0));
});

test('relaxed research geometry may discover new candidates without changing production', () => {
  const bars = priceFixture();
  bars[89] = { ...bars[89], low: 85 };
  assert.deepEqual(evaluateDeepReclaimPrice('TEST', bars), { qualified: false, reason: 'drawdown-out-of-range' });
  const relaxed = evaluateDeepReclaimPriceWithRules('TEST', bars, { ...DEEP_RECLAIM_GEOMETRY_V0, ddMaxPct: 25 });
  assert.equal(relaxed.qualified, true);
  assert.deepEqual(evaluateDeepReclaimPrice('TEST', bars), { qualified: false, reason: 'drawdown-out-of-range' });
});

test('research geometry rejects logically invalid parameter cells', () => {
  assert.throws(
    () => evaluateDeepReclaimPriceWithRules('TEST', priceFixture(), { ...DEEP_RECLAIM_GEOMETRY_V0, posMax: 1.1 }),
    /invalid deep-reclaim research geometry rules/,
  );
});

test('fresh EMA20 crossing is mandatory', () => {
  const bars = priceFixture();
  bars[98] = { ...bars[98], close: 100, high: Math.max(bars[98].high, 100) };
  const got = evaluateDeepReclaimPrice('TEST', bars);
  assert.equal(got.qualified, false);
  if (!got.qualified) assert.equal(got.reason, 'ema-not-fresh-reclaim');
});

test('ret4h must be strictly positive and no more than 6%', () => {
  const bars = priceFixture();
  bars[83] = { ...bars[83], close: bars[99].close, high: Math.max(bars[83].high, bars[99].close) };
  const got = evaluateDeepReclaimPrice('TEST', bars);
  assert.equal(got.qualified, false);
  if (!got.qualified) assert.equal(got.reason, 'momentum-out-of-range');
});

test('24h range position above 0.70 is rejected before later trigger checks', () => {
  const bars = priceFixture();
  bars[99] = { ...bars[99], open: 94, high: 106, low: 93.8, close: 105 };
  assert.deepEqual(evaluateDeepReclaimPrice('TEST', bars), { qualified: false, reason: 'position-too-high' });
});

test('setup close already above L0 + 0.5 ATR is rejected as extended', () => {
  const bars = priceFixture();
  bars[99] = { ...bars[99], open: 94, high: 100.3, low: 93.8, close: 99.8 };
  assert.deepEqual(evaluateDeepReclaimPrice('TEST', bars), { qualified: false, reason: 'already-extended' });
});

test('versioned price ranking is deterministic, copy-safe and non-gating', () => {
  const a = requirePrice(priceFixture(), 'AAA');
  const b: DeepReclaimPriceCandidate = { ...a, sym: 'BBB', rankScore: a.rankScore + 1 };
  const input = [a, b];
  const ranked = rankDeepReclaimCandidates(input);
  assert.deepEqual(ranked.map((x) => x.sym), ['BBB', 'AAA']);
  assert.notEqual(ranked[0], b);
  assert.deepEqual(input.map((x) => x.sym), ['AAA', 'BBB']);
  const { rankVersion: _v, rankScore: _s, ...base } = a;
  assert.equal(deepReclaimRankScore(base), a.rankScore);
});

test('operational Top-1 scoring is pure, separate and totally ordered', () => {
  const a = requirePrice(priceFixture(), 'AAA');
  const b: DeepReclaimPriceCandidate = { ...a, sym: 'BBB', rankScore: a.rankScore + 1 };
  const oi = passingOi(a.setupTs, { qty1h: 1.5, qty4h: 6.5 });
  const aOperational = deepReclaimOperationalScore(a, oi, 0.70);
  assert.notEqual(aOperational, a.rankScore);
  assert.equal(a.rankScore, requirePrice(priceFixture(), 'AAA').rankScore, 'score function does not mutate detector rank');
  const input = [
    { ...a, operationalScore: aOperational + 1 },
    { ...b, operationalScore: aOperational },
  ];
  const ranked = rankDeepReclaimOperationalCandidates(input);
  assert.deepEqual(ranked.map((x) => x.sym), ['AAA', 'BBB'], 'operational score leads before price-rank fallback');
  assert.notEqual(ranked[0], input[0]);
  assert.equal(input[0].rankScore, a.rankScore);
});

test('quantity OI requires an at-or-before observation no older than ten minutes', () => {
  const ts = requirePrice().setupTs;
  assert.equal(deepReclaimOiDecision(passingOi(ts), ts).code, 'pass');
  assert.equal(deepReclaimOiDecision(null, ts).code, 'missing');
  assert.equal(deepReclaimOiDecision({ observedAt: ts + 1, qty1h: 1, qty4h: 4 }, ts).code, 'future');
  assert.equal(deepReclaimOiDecision({ observedAt: ts - DEEP_RECLAIM_OI_MAX_AGE_MS, qty1h: 1, qty4h: 3 }, ts).code, 'pass');
  assert.equal(deepReclaimOiDecision({ observedAt: ts - DEEP_RECLAIM_OI_MAX_AGE_MS - 1, qty1h: 1, qty4h: 3 }, ts).code, 'stale');
});

test('fresh quantity OI fails closed unless qty1h > 0 and qty4h >= 3', () => {
  const ts = requirePrice().setupTs;
  assert.equal(deepReclaimOiDecision(passingOi(ts, { qty1h: 0 }), ts).code, 'rejected');
  assert.equal(deepReclaimOiDecision(passingOi(ts, { qty4h: 2.999 }), ts).code, 'rejected');
  assert.equal(deepReclaimOiDecision(passingOi(ts, { qty1h: Number.NaN }), ts).code, 'missing');
});

test('detect wrapper preserves every price-qualified candidate and attaches explicit OI eligibility', () => {
  const price = requirePrice();
  const missing = detectDeepReclaim('TEST', priceFixture(), null);
  assert.ok(missing);
  assert.equal(missing.oiQualified, false);
  assert.equal(missing.oiDecision.code, 'missing');
  const failed = attachDeepReclaimOiEligibility(price, passingOi(price.setupTs, { qty1h: 0 }));
  assert.equal(failed.oiQualified, false);
  assert.equal(failed.oiDecision.code, 'rejected');
  assert.equal(detectDeepReclaim('TEST', priceFixture().slice(1), null), null);
});

test('arm requires setup-time OI qualification and freezes geometry/OI by value', () => {
  const price = requirePrice();
  assert.equal(armDeepReclaim(price, null).candidate, null);
  assert.equal(armDeepReclaim(price, passingOi(price.setupTs, { qty4h: 2 })).candidate, null);
  const oi = passingOi(price.setupTs);
  const armed = armDeepReclaim(price, oi);
  assert.ok(armed.candidate);
  assert.equal(armed.event?.event, 'armed');
  assert.equal(armed.event?.status, 'watching');
  assert.equal(armed.candidate.bandLow, price.l0);
  oi.qty4h = 999;
  assert.equal(armed.candidate.setupOi.qty4h, 3);
});

test('setup bar can never self-confirm; repeated/older bars are idempotent no-ops', () => {
  const watch = requireWatch();
  const same = observedBar(watch, 0, watch.l0);
  const got = observeDeepReclaim(watch, same, passingOi(same.closeTs));
  assert.equal(got.candidate, watch);
  assert.equal(got.event, undefined);
});

test('later close in the frozen band plus fresh passing OI confirms', () => {
  const watch = requireWatch();
  const bar = observedBar(watch, 1, watch.bandLow);
  const got = observeDeepReclaim(watch, bar, passingOi(bar.closeTs));
  assert.equal(got.candidate.status, 'confirmed');
  assert.equal(got.candidate.confirmedAt, bar.closeTs);
  assert.equal(got.candidate.confirmedPx, watch.bandLow);
  assert.equal(got.event?.event, 'confirmed');
  assert.equal(got.event?.oiDecision, 'pass');
  assert.equal(got.event?.bandLow, watch.l0);
});

test('both confirmation-band boundaries are inclusive', () => {
  for (const px of [requireWatch().bandLow, requireWatch().bandHigh]) {
    const watch = requireWatch();
    const bar = observedBar(watch, 1, px);
    assert.equal(observeDeepReclaim(watch, bar, passingOi(bar.closeTs)).candidate.status, 'confirmed');
  }
});

test('missing, stale or future OI on a price-confirm bar emits wait and remains active', () => {
  for (const [expected, oi] of [
    ['missing', null],
    ['stale', { observedAt: 0, qty1h: 1, qty4h: 4 }],
    ['future', { observedAt: Number.MAX_SAFE_INTEGER, qty1h: 1, qty4h: 4 }],
  ] as const) {
    const watch = requireWatch();
    const bar = observedBar(watch, 1, watch.l0);
    const got = observeDeepReclaim(watch, bar, oi);
    assert.equal(got.candidate.status, 'watching');
    assert.equal(got.candidate.lastOiDecision, expected);
    assert.equal(got.event?.event, 'oi-wait');
    assert.equal(got.event?.oiDecision, expected);
  }
});

test('fresh failing OI is terminal only when price is inside the confirmation band', () => {
  const watch = requireWatch();
  const outside = observedBar(watch, 1, watch.bandLow - watch.atr14);
  const ignored = observeDeepReclaim(watch, outside, passingOi(outside.closeTs, { qty1h: 0 }));
  assert.equal(ignored.candidate.status, 'watching');
  assert.equal(ignored.event, undefined);
  const inside = observedBar(ignored.candidate, 2, watch.l0);
  const rejected = observeDeepReclaim(ignored.candidate, inside, passingOi(inside.closeTs, { qty1h: 0 }));
  assert.equal(rejected.candidate.status, 'oi-rejected');
  assert.equal(rejected.event?.event, 'oi-rejected');
  assert.equal(rejected.event?.oiDecision, 'rejected');
});

test('close strictly below the frozen trough invalidates; equality does not', () => {
  const watch = requireWatch();
  const equal = observedBar(watch, 1, watch.troughLow, { low: watch.troughLow, high: watch.troughLow + 0.1 });
  assert.equal(observeDeepReclaim(watch, equal).candidate.status, 'watching');
  const broken = observedBar(watch, 1, watch.troughLow - 0.01, {
    low: watch.troughLow - 0.02,
    high: watch.troughLow + 0.01,
  });
  const got = observeDeepReclaim(watch, broken);
  assert.equal(got.candidate.status, 'invalidated');
  assert.equal(got.event?.event, 'invalid');
});

test('high at L0 + 2 ATR marks missed before same-bar confirmation', () => {
  const watch = requireWatch();
  const bar = observedBar(watch, 1, watch.l0, { high: watch.missedAbove, low: watch.l0 - 0.1 });
  const got = observeDeepReclaim(watch, bar, passingOi(bar.closeTs));
  assert.equal(got.candidate.status, 'missed');
  assert.equal(got.event?.event, 'missed');
});

test('terminal precedence is expiry, then invalidation, then missed, then confirmation', () => {
  const watch = requireWatch();
  const expirySlots = DEEP_RECLAIM_EXPIRY_MS / DEEP_RECLAIM_SLOT_MS;
  const bar = observedBar(watch, expirySlots, watch.troughLow - 0.1, {
    low: watch.troughLow - 0.2,
    high: watch.missedAbove,
  });
  const got = observeDeepReclaim(watch, bar, passingOi(bar.closeTs));
  assert.equal(got.candidate.status, 'expired');
  assert.equal(got.event?.event, 'expired');
});

test('terminal watches ignore later observations', () => {
  const watch = requireWatch();
  const first = observedBar(watch, 1, watch.l0);
  const confirmed = observeDeepReclaim(watch, first, passingOi(first.closeTs)).candidate;
  const later = observedBar(confirmed, 2, confirmed.troughLow - 1);
  const got = observeDeepReclaim(confirmed, later, null);
  assert.equal(got.candidate, confirmed);
  assert.equal(got.event, undefined);
});

test('pure state helpers add an arm, keep an OI wait, then remove a terminal watch', () => {
  const price = requirePrice();
  const armed = armDeepReclaim(price, passingOi(price.setupTs));
  let state = applyDeepReclaimArm(emptyDeepReclaimState(), armed);
  assert.deepEqual(Object.keys(state.active), ['TEST']);
  const watch = state.active.TEST;
  const waitBar = observedBar(watch, 1, watch.l0);
  const wait = observeDeepReclaim(watch, waitBar, null);
  state = applyDeepReclaimTransition(state, wait);
  assert.equal(state.active.TEST.lastOiDecision, 'missing');
  const confirmBar = observedBar(state.active.TEST, 2, watch.l0);
  const done = observeDeepReclaim(state.active.TEST, confirmBar, passingOi(confirmBar.closeTs));
  state = applyDeepReclaimTransition(state, done);
  assert.deepEqual(state.active, {});
  assert.deepEqual(activeDeepReclaims(state), []);
});

test('sanitizeDeepReclaimState preserves valid operational metadata by value', () => {
  const watch: DeepReclaimWatch = {
    ...requireWatch(),
    delivery: 'delivered',
    telegramMessageId: 42,
    earlyDeliveredAt: requireWatch().setupTs + 1,
    attemptCount: 1,
    nextAttemptAt: requireWatch().setupTs + 60_000,
    buyShare4h: 0.61,
    operationalScore: 77.5,
    selectionPolicyId: DEEP_RECLAIM_SELECTION_POLICY_ID,
  };
  const raw = { v: 1, updatedAt: watch.setupTs, active: { TEST: watch } };
  const clean = sanitizeDeepReclaimState(raw);
  assert.notEqual(clean, raw);
  assert.notEqual(clean.active.TEST, watch);
  assert.equal(clean.active.TEST.delivery, 'delivered');
  assert.equal(clean.active.TEST.telegramMessageId, 42);
  assert.equal(clean.active.TEST.buyShare4h, 0.61);
  assert.equal(clean.active.TEST.operationalScore, 77.5);
  assert.equal(clean.active.TEST.selectionPolicyId, DEEP_RECLAIM_SELECTION_POLICY_ID);
});

test('legacy active watches remain monitorable but are marked unversioned', () => {
  const watch = requireWatch() as DeepReclaimWatch & { rulesetId?: string; selectionPolicyId?: string };
  delete watch.rulesetId;
  delete watch.selectionPolicyId;
  const clean = sanitizeDeepReclaimState({ v: 1, updatedAt: watch.setupTs, active: { TEST: watch } });
  assert.equal(clean.active.TEST.rulesetId, DEEP_RECLAIM_LEGACY_RULESET_ID);
  assert.equal(clean.active.TEST.selectionPolicyId, DEEP_RECLAIM_LEGACY_SELECTION_POLICY_ID);
});

test('sanitizer drops corrupt rows independently and rejects terminal rows from active state', () => {
  const good = requireWatch();
  const badBand = { ...requireWatch(), sym: 'BAD', id: `deep-reclaim-v0:BAD:${good.setupTs}`, bandHigh: good.bandHigh + 1 };
  const terminal = { ...requireWatch(), sym: 'DONE', id: `deep-reclaim-v0:DONE:${good.setupTs}`, status: 'confirmed' };
  const clean = sanitizeDeepReclaimState({
    v: 1,
    updatedAt: good.setupTs,
    active: { TEST: good, BAD: badBand, DONE: terminal, JUNK: 'nope' },
  });
  assert.deepEqual(Object.keys(clean.active), ['TEST']);
  assert.deepEqual(sanitizeDeepReclaimState(null), emptyDeepReclaimState());
});

if (failures) {
  console.error(`\n${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.log(`\n${passes} deep-reclaim tests passed`);
