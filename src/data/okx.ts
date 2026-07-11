// OKX v5 client — LIQUIDATIONS ONLY since the 2026-07-07 Binance migration.
// Everything else (universe, klines, OI, funding, spot, LS ratio) moved to
// ./binance.ts. This stays on OKX because Binance removed its public REST
// force-order endpoint (liquidations are WS-only there, @forceOrder) — until an
// S4c-style WS collector exists, the S4e phase-1 event stream keeps polling
// OKX's REST endpoint. Consumed only by the headless recorder (Node), so no
// browser proxy is needed.

// Per-request hard timeout: a hung socket must become a normal failure the
// retry/backoff absorbs, not a silent stall of the recorder's liq pass.
const OKX_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function okxGet(base: string, path: string, tries = 3): Promise<any[]> {
  let lastErr: unknown;
  for (let k = 0; k < tries; k++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), OKX_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(base + path, { signal: ctl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429 || res.status >= 500) {
        console.warn(`[okx] ${res.status} on ${path} (retry ${k + 1}/${tries})`);
        await sleep(500 * (k + 1));
        continue;
      }
      const j = await res.json();
      if (j.code !== undefined && j.code !== '0') throw new Error(`okx ${j.code} ${j.msg}`);
      return j.data ?? [];
    } catch (e) {
      lastErr = e; // includes AbortError on timeout — treated like any transient failure
      await sleep(300 * (k + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`okx failed: ${path}`);
}

// S4e: contract values (coin units per contract) for USD-izing liquidation
// sizes. One bulk instruments call, cached 6h — ctVal is fixed per instrument,
// only new listings add entries, so a long cache can't go stale in a harmful way.
let ctValCache: { at: number; map: Map<string, number> } | null = null;

async function getCtValMap(baseUrl: string): Promise<Map<string, number>> {
  if (ctValCache && Date.now() - ctValCache.at < 6 * 3600_000) return ctValCache.map;
  const rows = await okxGet(baseUrl, '/api/v5/public/instruments?instType=SWAP');
  const map = new Map<string, number>();
  for (const r of rows) {
    const instId: string = r.instId ?? '';
    const v = Number(r.ctVal);
    if (instId.endsWith('-USDT-SWAP') && Number.isFinite(v) && v > 0) map.set(instId, v);
  }
  ctValCache = { at: Date.now(), map };
  return map;
}

// S4e phase 1: one liquidation event, USD-ized. dir 0 = long liquidated
// (forced sell), 1 = short liquidated (forced buy). px is bkPx — the bankruptcy
// price, which is exactly what the phase-2 leverage calibration needs.
export interface LiqEvent {
  ts: number; // ms epoch
  px: number;
  usd: number; // sz(contracts) × ctVal × bkPx — verified against live data 2026-07-06
  dir: 0 | 1;
}

// Recent filled liquidation orders for one coin, clipped to ts > sinceTs.
// Single page (newest ~100): at a 15-min poll cadence truncation only matters
// in an extreme cascade, and the recorded burst count still shows it. The
// endpoint REQUIRES uly — one request per coin — so callers keep this
// candidate-tier (see docs/roadmap/S4e-liquidations.md). Note the API's
// `limit` param does not reliably bound details[] — rely on the ts filter.
//
// Cross-exchange caveat (post-migration): these are OKX liquidations while all
// price/OI context is Binance. Levels and burst sizes remain directionally
// informative, but the S4e phase-2 leverage calibration must account for the
// venue mismatch (noted in the spec's gate).
export async function fetchLiquidations(
  baseUrl: string,
  base: string,
  sinceTs: number,
): Promise<LiqEvent[]> {
  const instId = `${base}-USDT-SWAP`;
  const [rows, ctVals] = await Promise.all([
    okxGet(
      baseUrl,
      `/api/v5/public/liquidation-orders?instType=SWAP&state=filled&uly=${base}-USDT&limit=100`,
    ),
    getCtValMap(baseUrl),
  ]);
  const ctVal = ctVals.get(instId);
  if (ctVal == null) return [];
  const out: LiqEvent[] = [];
  for (const r of rows) {
    if (r.instId && r.instId !== instId) continue; // hard-filter in case uly ever spans more
    for (const d of r.details ?? []) {
      const ts = Number(d.ts);
      const px = Number(d.bkPx);
      const sz = Number(d.sz);
      if (!Number.isFinite(ts) || !(px > 0) || !(sz > 0) || ts <= sinceTs) continue;
      const dir: 0 | 1 = d.posSide === 'short' || (d.posSide !== 'long' && d.side === 'buy') ? 1 : 0;
      out.push({ ts, px: Number(px.toPrecision(6)), usd: Math.round(sz * ctVal * px), dir });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
