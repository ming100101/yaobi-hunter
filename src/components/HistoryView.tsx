import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, createChart, LineSeries, type LineWidth, type UTCTimestamp } from 'lightweight-charts';
import {
  evalStates,
  F,
  forward,
  H4,
  H24,
  parseRecordings,
  risingEdges,
  runEval,
  SLOT_MS,
  summarize,
  type EvalResults,
  type EvalSource,
  type RecIndex,
  type Sample,
  type StateSummary,
} from '../lib/evalCore';
import { recCoinField, type RecCoin } from '../lib/recording';
import { fmtClock, fmtMoney, fmtPct, fmtPrice } from '../lib/format';
import { cssVar } from '../lib/cssVar';
import {
  evaluateSignalOutcome,
  parseDeliveredSignals,
  type SignalNotifyEvent,
} from '../lib/signalEvents';
import { kvGet } from '../data/cache';
import {
  paperBlotter,
  paperBook,
  paperStats,
  type BlotterPos,
  type PaperBookId,
  type PaperState,
} from '../lib/paper';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';
import TgOutcomeSection from './TgOutcomeSection';

// M2 記錄 tab: 訊號日誌 + lift 表 (session 1) + 時間軸回放 / 模擬盤 equity curve /
// replay 重跑 (session 2) — every number flows through the SAME evalCore the CLI
// (npm run eval-rec) uses, so the tab and the CLI can never disagree.

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  onSelect: (symbol: string) => void; // row click → open the coin's detail view
}

const DAY_MS = 24 * 3600 * 1000;
const TARGET = 10; // MFE % for the hit-rate / lift table (matches eval-rec default)
const MIN_SAMPLE = 20; // below this, a state's numbers are flagged 樣本不足
const JOURNAL_CAP = 250; // rows rendered (newest first); the count note shows the rest

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const liftCls = (l: number) => (l >= 1 ? 'up' : 'down');

// ---- lift table (evalCore states × 4h/24h vs baseline) ----
function LiftTable({ results }: { results: EvalResults }) {
  const b4 = results.baseline.h4;
  const b24 = results.baseline.h24;
  return (
    <div className="card hist-table">
      <div className="hist-lift-head">
        <span>訊號</span>
        <span className="ta-r">events</span>
        <span className="ta-r">4h 命中</span>
        <span className="ta-r">4h lift</span>
        <span className="ta-r">24h 命中</span>
        <span className="ta-r">24h lift</span>
        <span className="ta-r">24h MFE</span>
        <span className="ta-r" title="訊號比大 move 早幾耐 fire(中位)— 越大越早。move = 到目標 25% 嗰刻">
          提早(中位)
        </span>
      </div>
      <div className="hist-lift-row">
        <span className="muted">基準(全部觀測)</span>
        <span className="ta-r muted">—</span>
        <span className="ta-r num">{pct(b4.hit)}</span>
        <span className="ta-r muted">×1.00</span>
        <span className="ta-r num">{pct(b24.hit)}</span>
        <span className="ta-r muted">×1.00</span>
        <span className="ta-r num">{pct(b24.meanMfe)}</span>
        <span className="ta-r muted">—</span>
      </div>
      {Object.entries(results.states).map(([key, r]) => {
        const l4 = b4.hit > 0 ? r.h4.hit / b4.hit : 0;
        const l24 = b24.hit > 0 ? r.h24.hit / b24.hit : 0;
        return (
          <div className="hist-lift-row" key={key}>
            <span>
              {key}
              {r.events < MIN_SAMPLE && (
                <span className="hist-warn" title="樣本 < 20,數字未穩定,僅供參考">
                  樣本不足
                </span>
              )}
            </span>
            <span className="ta-r num">{r.events}</span>
            <span className="ta-r num">{pct(r.h4.hit)}</span>
            <span className={`ta-r num ${liftCls(l4)}`}>×{l4.toFixed(2)}</span>
            <span className="ta-r num">{pct(r.h24.hit)}</span>
            <span className={`ta-r num ${liftCls(l24)}`}>×{l24.toFixed(2)}</span>
            <span className="ta-r num">{pct(r.h24.meanMfe)}</span>
            <span className="ta-r num" title={r.lead && r.lead.n ? `n=${r.lead.n} · p25 ${(r.lead.p25 * 0.25).toFixed(1)}h · p75 ${(r.lead.p75 * 0.25).toFixed(1)}h` : '冇到目標嘅 move,提早無得計'}>
              {r.lead && r.lead.n ? `${(r.lead.med * 0.25).toFixed(1)}h` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---- signal journal (⚡/蓄 rising edges + forward returns + TG notify log) ----
interface JournalRow {
  sym: string;
  slot: number;
  ts: number;
  price: number;
  label: string;
  tg: boolean; // a Telegram card actually went out for this (sym, slot)
  r1: number | null;
  r4: number | null;
  r24: number | null;
  mfe24: number | null;
}

const NOTIFY_LABEL: Record<string, string> = { fb: '⚡', rb: '📈', vg: '🚀' };
const SLOT_MS_15 = 15 * 60 * 1000;

function buildJournal(idx: RecIndex, notifies: SignalNotifyEvent[]): JournalRow[] {
  const states = evalStates(idx).slice(0, 2); // ⚡ flushBreakout, 蓄 earlyAccum
  const label: Record<string, string> = { '⚡ flushBreakout': '⚡', '蓄 earlyAccum': '蓄' };
  // (sym, slot) → notify line, so edge rows can wear the TG chip and TG-only
  // fires (micro-scan ⚡, 增倉突破 — invisible to RecCoin edges) get own rows
  const bySlot = new Map<string, SignalNotifyEvent>();
  for (const n of notifies) bySlot.set(`${n.sym}|${Math.floor(n.ts / SLOT_MS_15)}`, n);
  const rows: JournalRow[] = [];
  for (const st of states) {
    for (const e of risingEdges(idx, st.on)) {
      const f1 = forward(idx, e.sym, e.slot, 4); // +1h (4 slots)
      const f4 = forward(idx, e.sym, e.slot, 16); // +4h
      const f24 = forward(idx, e.sym, e.slot, 96); // +24h
      const key = `${e.sym}|${e.slot}`;
      // A delivered TG row is anchored to its own success time/card price and
      // therefore replaces the detector-only row for the same 15m slot.
      if (bySlot.has(key)) continue;
      rows.push({
        sym: e.sym,
        slot: e.slot,
        ts: e.ts,
        price: e.price,
        label: label[st.key] ?? st.key,
        tg: false,
        r1: f1?.ret ?? null,
        r4: f4?.ret ?? null,
        r24: f24?.ret ?? null,
        mfe24: f24?.mfe ?? null,
      });
    }
  }
  // Every delivered TG card gets its own authoritative row. Outcome paths use
  // the shared strict evaluator, never the same-slot scan price.
  for (const n of notifies) {
    const slot = Math.floor(n.ts / SLOT_MS_15);
    const f1 = evaluateSignalOutcome(idx, n, 4, 'tg-card');
    const f4 = evaluateSignalOutcome(idx, n, 16, 'tg-card');
    const f24 = evaluateSignalOutcome(idx, n, 96, 'tg-card');
    rows.push({
      sym: n.sym,
      slot,
      ts: n.ts,
      price: n.px,
      label: NOTIFY_LABEL[n.cls] ?? n.cls,
      tg: true,
      r1: f1.status === 'complete' ? f1.ret ?? null : null,
      r4: f4.status === 'complete' ? f4.ret ?? null : null,
      r24: f24.status === 'complete' ? f24.ret ?? null : null,
      mfe24: f24.status === 'complete' ? f24.mfe ?? null : null,
    });
  }
  return rows.sort((a, b) => b.ts - a.ts); // newest first
}

const RetCell = ({ x }: { x: number | null }) =>
  x == null ? (
    <span className="ta-r muted">—</span>
  ) : (
    <span className={`ta-r num ${x >= 0 ? 'up' : 'down'}`}>{fmtPct(x * 100, 1)}</span>
  );

function SignalJournal({ rows, onSelect }: { rows: JournalRow[]; onSelect: (s: string) => void }) {
  const shown = rows.slice(0, JOURNAL_CAP);
  return (
    <div className="card hist-table">
      <div className="hist-jrn-head">
        <span>時間</span>
        <span>幣</span>
        <span>訊號</span>
        <span className="ta-r">當時價</span>
        <span className="ta-r">+1h</span>
        <span className="ta-r">+4h</span>
        <span className="ta-r">+24h</span>
        <span className="ta-r">MFE24h</span>
      </div>
      {shown.map((r) => (
        <div
          key={`${r.sym}-${r.slot}-${r.label}`}
          className="hist-jrn-row"
          role="button"
          tabIndex={0}
          onClick={() => onSelect(r.sym)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(r.sym);
            }
          }}
        >
          <span className="muted">{fmtClock(r.ts)}</span>
          <span className="sym">{r.sym}</span>
          <span className="hist-sig">
            {r.label}
            {r.tg && (
              <span className="blot-fill" title="呢個訊號有 Telegram 卡發出(notify log 實錄)" style={{ marginLeft: 6 }}>
                TG
              </span>
            )}
          </span>
          <span className="ta-r num muted">{fmtPrice(r.price)}</span>
          <RetCell x={r.r1} />
          <RetCell x={r.r4} />
          <RetCell x={r.r24} />
          <span className={`ta-r num ${(r.mfe24 ?? 0) >= 0 ? 'up' : 'down'}`}>
            {r.mfe24 == null ? '—' : fmtPct(r.mfe24 * 100, 1)}
          </span>
        </div>
      ))}
      {rows.length === 0 && <div className="sr-empty muted">此範圍內未有 ⚡/蓄 訊號。</div>}
      {rows.length > JOURNAL_CAP && (
        <div className="hist-more muted">顯示最新 {JOURNAL_CAP} 筆,共 {rows.length} 筆。</div>
      )}
    </div>
  );
}

// ---- 時間軸回放 — slot slider over the recorded sweeps (screener time machine) ----
const REGIME_ZH: Record<string, string> = { A: '蓄力', P: '拉升', D: '出貨' };

function TimelineScrubber({ idx, onSelect }: { idx: RecIndex; onSelect: (s: string) => void }) {
  const n = idx.slots.length;
  const [si, setSi] = useState(n - 1);
  // a new date range = a new slot list; snap back to the newest slot
  useEffect(() => setSi(n - 1), [idx, n]);
  const clamped = Math.min(Math.max(si, 0), n - 1);
  const slot = idx.slots[clamped];
  const top = useMemo(() => {
    const coins = idx.bySlot.get(slot)!.coins as RecCoin[];
    return [...coins].sort((a, b) => (b[F.STR] as number) - (a[F.STR] as number)).slice(0, 10);
  }, [idx, slot]);

  return (
    <div className="card hist-table">
      <div className="hist-scrub-bar">
        <input
          className="hist-scrub-range"
          type="range"
          min={0}
          max={n - 1}
          value={clamped}
          onChange={(e) => setSi(Number(e.target.value))}
          aria-label="回放時間軸"
        />
        <span className="muted num">
          {fmtDayClock(slot * SLOT_MS)} · 第 {clamped + 1}/{n} 格
        </span>
      </div>
      <div className="hist-top10-head">
        <span>#</span>
        <span>幣</span>
        <span className="ta-r">當時價</span>
        <span className="ta-r">強度</span>
        <span>階段</span>
        <span>訊號</span>
      </div>
      {top.map((r, i) => (
        <div
          key={r[F.SYM] as string}
          className="hist-top10-row"
          role="button"
          tabIndex={0}
          onClick={() => onSelect(r[F.SYM] as string)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(r[F.SYM] as string);
            }
          }}
        >
          <span className="muted">{i + 1}</span>
          <span className="sym">{r[F.SYM] as string}</span>
          <span className="ta-r num">{fmtPrice(r[F.PRICE] as number)}</span>
          <span className="ta-r num">{r[F.STR] as number}</span>
          <span className="muted">{REGIME_ZH[r[6] as string] ?? (r[6] as string)}</span>
          <span className="hist-sig">
            {r[F.FB] === 1 && '⚡'}
            {r[F.EA] === 1 && '蓄'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- replay 重跑 — feature-level predicate over the recorded v2 columns.
// HONESTLY feature-level: recordings carry no candle/OI series, so the full
// detectors (48h shapes) can NOT be re-run here — this replays thresholds over
// the recorded feature vector only, sampled/summarised by the same evalCore
// machinery as everything else on this tab. ----
interface ReplayFields {
  volZMin: string; // volZ ≥ (idx 4, always recorded)
  oi4hMax: string; // oi4h ≤ (idx 21, null = untrusted/v1 → 不適用)
  posMax: string; // pos ≤ (idx 12; 0..1 range position)
  fundAbsMax: string; // |funding| ≤ (idx 3)
  basisMax: string; // basisPct ≤ (idx 20, null = no spot pair → 不適用)
}
const REPLAY_EMPTY: ReplayFields = { volZMin: '', oi4hMax: '', posMax: '', fundAbsMax: '', basisMax: '' };
// presets are APPROXIMATIONS of the real detectors over available features —
// labeled 近似 in the UI; the real gates live on full series the recordings lack
const REPLAY_PRESETS: Array<{ label: string; fields: ReplayFields }> = [
  { label: '⚡ 近似', fields: { ...REPLAY_EMPTY, volZMin: '1.5', oi4hMax: '0' } },
  { label: '蓄 setup 近似', fields: { ...REPLAY_EMPTY, oi4hMax: '-3', posMax: '0.5', fundAbsMax: '0.01' } },
];

interface ReplayOutcome {
  events: number;
  na: number; // observations skipped because a used feature was null
  h4: StateSummary;
  h24: StateSummary;
}

function runReplay(idx: RecIndex, f: ReplayFields, target: number): ReplayOutcome | string {
  type Cond = (r: RecCoin) => boolean | null; // null = feature unavailable on this row
  const conds: Cond[] = [];
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const volZ = num(f.volZMin);
  if (volZ != null) conds.push((r) => (r[4] as number) >= volZ);
  const oi4h = num(f.oi4hMax);
  if (oi4h != null)
    conds.push((r) => {
      const v = recCoinField(r, 21);
      return v == null ? null : v <= oi4h;
    });
  const pos = num(f.posMax);
  if (pos != null)
    conds.push((r) => {
      const v = recCoinField(r, 12);
      return v == null ? null : v <= pos;
    });
  const fund = num(f.fundAbsMax);
  if (fund != null) conds.push((r) => Math.abs(r[F.FUND] as number) <= fund);
  const basis = num(f.basisMax);
  if (basis != null)
    conds.push((r) => {
      const v = recCoinField(r, 20);
      return v == null ? null : v <= basis;
    });
  if (!conds.length) return '至少填一個條件(留空 = 不限)。';
  for (const [k, v] of Object.entries(f)) if (v.trim() !== '' && !Number.isFinite(Number(v))) return `「${k}」唔係數字。`;

  // 不適用 count over all observations (a used feature is null on that row)
  let na = 0;
  for (const slot of idx.slots) {
    for (const r of idx.bySlot.get(slot)!.coins as RecCoin[]) {
      if (conds.some((c) => c(r) === null)) na++;
    }
  }
  const on = (r: RecCoin) => conds.every((c) => c(r) === true);
  const edges = risingEdges(idx, on);
  const s4: Sample[] = [];
  const s24: Sample[] = [];
  for (const e of edges) {
    const f4 = forward(idx, e.sym, e.slot, H4);
    if (f4) s4.push(f4);
    const f24 = forward(idx, e.sym, e.slot, H24);
    if (f24) s24.push(f24);
  }
  return { events: edges.length, na, h4: summarize(s4, target), h24: summarize(s24, target) };
}

function ReplayPanel({ idx, results }: { idx: RecIndex; results: EvalResults }) {
  const [fields, setFields] = useState<ReplayFields>(REPLAY_PRESETS[0].fields);
  const [out, setOut] = useState<ReplayOutcome | string | null>(null);
  const set = (k: keyof ReplayFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((p) => ({ ...p, [k]: e.target.value }));
  const b4 = results.baseline.h4;
  const b24 = results.baseline.h24;
  const oc = typeof out === 'object' && out != null ? out : null;

  return (
    <div className="card hist-table">
      <div className="hist-replay-form">
        <label>
          量Z ≥ <input value={fields.volZMin} onChange={set('volZMin')} placeholder="不限" inputMode="decimal" />
        </label>
        <label>
          OI4h% ≤ <input value={fields.oi4hMax} onChange={set('oi4hMax')} placeholder="不限" inputMode="decimal" />
        </label>
        <label>
          位置 ≤ <input value={fields.posMax} onChange={set('posMax')} placeholder="0-1" inputMode="decimal" />
        </label>
        <label>
          |費率| ≤ <input value={fields.fundAbsMax} onChange={set('fundAbsMax')} placeholder="不限" inputMode="decimal" />
        </label>
        <label>
          基差% ≤ <input value={fields.basisMax} onChange={set('basisMax')} placeholder="不限" inputMode="decimal" />
        </label>
        {REPLAY_PRESETS.map((p) => (
          <button key={p.label} type="button" className="fb-toggle" onClick={() => setFields(p.fields)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="fb-toggle on" onClick={() => setOut(runReplay(idx, fields, TARGET))}>
          ▶ 重跑
        </button>
      </div>
      {typeof out === 'string' && <div className="sr-empty muted">{out}</div>}
      {oc && (
        <>
          <div className="hist-lift-head">
            <span>自訂條件</span>
            <span className="ta-r">events</span>
            <span className="ta-r">4h 命中</span>
            <span className="ta-r">4h lift</span>
            <span className="ta-r">24h 命中</span>
            <span className="ta-r">24h lift</span>
            <span className="ta-r">24h MFE</span>
          </div>
          <div className="hist-lift-row">
            <span>
              重跑結果
              {oc.events < MIN_SAMPLE && (
                <span className="hist-warn" title="樣本 < 20,數字未穩定,僅供參考">
                  樣本不足
                </span>
              )}
            </span>
            <span className="ta-r num">{oc.events}</span>
            <span className="ta-r num">{pct(oc.h4.hit)}</span>
            <span className={`ta-r num ${liftCls(b4.hit > 0 ? oc.h4.hit / b4.hit : 0)}`}>
              ×{(b4.hit > 0 ? oc.h4.hit / b4.hit : 0).toFixed(2)}
            </span>
            <span className="ta-r num">{pct(oc.h24.hit)}</span>
            <span className={`ta-r num ${liftCls(b24.hit > 0 ? oc.h24.hit / b24.hit : 0)}`}>
              ×{(b24.hit > 0 ? oc.h24.hit / b24.hit : 0).toFixed(2)}
            </span>
            <span className="ta-r num">{pct(oc.h24.meanMfe)}</span>
          </div>
          {oc.na > 0 && <div className="hist-more muted">不適用 {oc.na} 筆觀測(所用特徵喺該行係 null — v1 行/無現貨/OI 未信任)。</div>}
        </>
      )}
      <div className="hist-more muted">
        特徵級重跑:只重算「已記錄特徵」嘅門檻,唔係完整序列回測(⚡/增/擴 嘅 48h 形狀條件 recordings 冇帶)。
      </div>
    </div>
  );
}

// ---- 模擬盤 equity curve (lightweight-charts line over PaperState.curve) ----
function EquityCurve({ curve, startEquity }: { curve: [number, number][]; startEquity: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || curve.length < 2) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: cssVar('--text-3'),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { horzLines: { color: cssVar('--grid') }, vertLines: { visible: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    });
    const line = chart.addSeries(LineSeries, {
      color: cssVar('--accent'),
      lineWidth: 2 as LineWidth,
      priceLineVisible: false,
    });
    line.createPriceLine({
      price: startEquity,
      color: cssVar('--text-3'),
      lineWidth: 1 as LineWidth,
      lineStyle: 3,
      axisLabelVisible: false,
      title: '起點',
    });
    // curve points share a second occasionally (two drivers) — keep the last per second
    const byTime = new Map<number, number>();
    for (const [t, v] of curve) byTime.set(Math.floor(t / 1000), v);
    line.setData(
      [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v })),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [curve, startEquity]);
  if (curve.length < 2) return <div className="sr-empty muted">Equity curve 未夠點(要 ≥ 2 個已驅動 sweep)。</div>;
  return <div className="hist-eq-box" ref={ref} />;
}

// ---- 模擬盤交易簿 — position-grouped paper fills (lib/paper.paperBlotter) ----
const ARM_LABEL: Record<PaperBookId, string> = {
  confirmed: '確認盤(現行)',
  A: 'A 淺梯(現行)',
  B: 'B 老詹梯',
  C: 'C 全止盈',
};
const FILL_ZH: Record<string, string> = { tp1: 'TP1', tp2: 'TP2', tp3: 'TP3', sl: 'SL', timeout: '到期' };

const fmtDayClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// raw per-fill CSV — the objective export (one row per fill, entry rows included)
function exportBlotterCsv(paper: PaperState): void {
  const lines = ['book,sym,signal_time,signal_price,open_time,entry,entry_slippage_pct,entry_policy,action,fill_time,price,frac_of_position,pnl_usd'];
  const iso = (ms: number) => new Date(ms).toISOString();
  for (const arm of ['confirmed', 'A', 'B', 'C'] as PaperBookId[]) {
    const book = paperBook(paper, arm);
    if (!book) continue;
    for (const pos of paperBlotter(book)) {
      lines.push(
        `${arm},${pos.sym},${pos.signalTs ? iso(pos.signalTs) : ''},${pos.signalPx ?? ''},${iso(pos.openTs)},${pos.entry},${pos.entrySlippagePct ?? ''},${pos.entryPolicyId ?? ''},open,${iso(pos.openTs)},${pos.entry},1,${pos.pnl - pos.fills.reduce((s, f) => s + f.pnl, 0)}`,
      );
      for (const f of pos.fills)
        lines.push(`${arm},${pos.sym},${pos.signalTs ? iso(pos.signalTs) : ''},${pos.signalPx ?? ''},${iso(pos.openTs)},${pos.entry},${pos.entrySlippagePct ?? ''},${pos.entryPolicyId ?? ''},${f.action},${iso(f.ts)},${f.px},${f.frac},${f.pnl}`);
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `paper-blotter-${ymd(Date.now())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function PaperBlotterSection({ onSelect }: { onSelect: (s: string) => void }) {
  const [paper, setPaper] = useState<PaperState | null>(null);
  const [arm, setArm] = useState<PaperBookId>('confirmed');
  useEffect(() => {
    let cancelled = false;
    void kvGet<PaperState>('paper-state').then((p) => {
      if (!cancelled) setPaper(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const rows = useMemo(() => {
    if (!paper) return [] as BlotterPos[];
    const book = paperBook(paper, arm);
    return book ? paperBlotter(book) : [];
  }, [paper, arm]);
  if (!paper) return null;
  const book = paperBook(paper, arm);
  const stats = book ? paperStats(book) : null;

  return (
    <>
      <div className="hist-section-title">
        模擬盤交易簿(確認盤現行 · 舊即時入場帳只作 control)
      </div>
      <div className="hist-blot-bar">
        {(['confirmed', 'A', 'B', 'C'] as PaperBookId[]).map((a) => (
          <button
            key={a}
            type="button"
            className={`fb-toggle${arm === a ? ' on' : ''}`}
            onClick={() => setArm(a)}
          >
            {ARM_LABEL[a]}
          </button>
        ))}
        <button type="button" className="fb-toggle" onClick={() => exportBlotterCsv(paper)}>
          ⬇ CSV(全部帳逐筆)
        </button>
      </div>
      {book && stats && (
        <div className="card hist-eq-card">
          <div className="hist-eq-stats">
            <span className="chip num">Equity {fmtMoney(stats.equity)}</span>
            <span className={`chip num ${stats.retPct >= 0 ? 'up' : 'down'}`}>{fmtPct(stats.retPct, 1)}</span>
            <span className="chip num">勝率 {(stats.winRate * 100).toFixed(0)}%</span>
            <span className="chip num">PF {Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}</span>
            <span className="chip num">最大回撤 {(stats.maxDrawdown * 100).toFixed(1)}%</span>
            <span className="chip muted">持倉 {stats.openCount} · 已平 {stats.closedCount}</span>
          </div>
          <EquityCurve curve={book.curve} startEquity={book.cfg.startEquity} />
        </div>
      )}
      <div className="card hist-table">
        <div className="hist-blot-head">
          <span>開倉時間</span>
          <span>幣</span>
          <span className="ta-r">入價</span>
          <span className="ta-r">1R($)</span>
          <span>出場</span>
          <span className="ta-r">P&L($)</span>
          <span className="ta-r">R</span>
          <span className="ta-r">狀態</span>
        </div>
        {rows.map((p) => (
          <div
            key={`${p.sym}-${p.openTs}`}
            className="hist-blot-row"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(p.sym)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(p.sym);
              }
            }}
          >
            <span className="muted">{fmtDayClock(p.openTs)}</span>
            <span className="sym">{p.sym}</span>
            <span className="ta-r num">{fmtPrice(p.entry)}</span>
            <span className="ta-r num muted">{p.riskUsd.toFixed(0)}</span>
            <span>
              {p.fills.length === 0 && <span className="blot-fill muted">未有出場</span>}
              {p.fills.map((f, i) => (
                <span key={i} className="blot-fill" title={`${new Date(f.ts).toLocaleString()} · ${(f.frac * 100).toFixed(0)}% 倉`}>
                  {FILL_ZH[f.action] ?? f.action} {fmtPrice(f.px)}({f.pnl >= 0 ? '+' : ''}{f.pnl.toFixed(1)})
                </span>
              ))}
            </span>
            <span className={`ta-r num ${p.pnl >= 0 ? 'up' : 'down'}`}>{p.pnl.toFixed(1)}</span>
            <span className={`ta-r num ${(p.r ?? 0) >= 0 ? 'up' : 'down'}`}>
              {p.r == null ? '—' : p.r.toFixed(2)}
            </span>
            <span className="ta-r">
              {p.closed ? (
                <span className="muted">已平</span>
              ) : (
                <span className="blot-fill blot-open">持倉 {(p.remainingFrac * 100).toFixed(0)}%</span>
              )}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="sr-empty muted">
            {ARM_LABEL[arm]} 未有成交 — {arm === 'confirmed' ? '等訊號排隊後下一個完整 15m sweep。' : '舊對照帳由各自開帳日起計。'}
          </div>
        )}
      </div>
    </>
  );
}

const ERA_LABEL: Record<'all' | 'okx' | 'binance', string> = {
  binance: 'Binance 年代',
  okx: 'OKX 年代',
  all: '混合 seam',
};
const SRC_LABEL: Record<EvalSource, string> = { auto: '本源', binance: 'Binance', okx: 'OKX 舊', all: '混合⚠' };

export default function HistoryView({ tab, onTab, onSelect }: Props) {
  const now = Date.now();
  const [from, setFrom] = useState(() => ymd(now - 14 * DAY_MS));
  const [to, setTo] = useState(() => ymd(now));
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  // seam filter for the lift table: default 'auto' = newest era, so it never
  // blends the OKX→Binance migration seam (the journal/replay below stay all-era)
  const [evalSrc, setEvalSrc] = useState<EvalSource>('auto');

  // Fetch on mount + whenever the range changes. Self-cancelling: if the user
  // leaves the tab (unmount) or changes the range mid-fetch, the stale response
  // is ignored (no setState-after-unmount) and the in-flight request is aborted.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      setStatus('loading');
      try {
        const res = await fetch(`/recordings?from=${from}&to=${to}`, { signal: ctrl.signal });
        if (cancelled) return;
        if (!res.ok) {
          setStatus(res.status === 413 ? 'error' : 'empty');
          setText(null);
          return;
        }
        const body = await res.text();
        if (cancelled) return;
        setText(body);
        setStatus(body.trim() ? 'ready' : 'empty');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [from, to]);

  const idx = useMemo(() => (text != null ? parseRecordings(text) : null), [text]);
  const results = useMemo(
    () => (idx && idx.slots.length >= 2 ? runEval(idx, TARGET, evalSrc) : null),
    [idx, evalSrc],
  );
  const notifies = useMemo(() => (text != null ? parseDeliveredSignals(text) : []), [text]);
  const journal = useMemo(() => (idx ? buildJournal(idx, notifies) : []), [idx, notifies]);

  return (
    <div className="page history-page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">記錄回放 · 已錄訊號嘅 lift 同日誌(同 CLI eval-rec 同一套數)</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <div className="hist-controls">
        <label className="hist-date">
          由 <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="hist-date">
          至 <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span className="muted hist-hint">MFE 命中門檻 +{TARGET}% · 上限 92 日</span>
      </div>

      {/* 交易簿 reads kv paper-state directly — independent of the recordings range */}
      <PaperBlotterSection onSelect={onSelect} />

      {status === 'loading' && (
        <div className="card strat-msg">
          <div className="spinner" /> 載入記錄中…
        </div>
      )}
      {status === 'error' && (
        <div className="card strat-msg">讀取記錄失敗 — 需喺 dev 伺服器或 exe 內執行,範圍亦不可超過 92 日。</div>
      )}
      {status === 'empty' && (
        <div className="card strat-msg">
          此範圍未有記錄 — 行 <code>npm run recorder</code> 開始累積,或擴大日期範圍。
        </div>
      )}

      {status === 'ready' && (
        <>
          {idx && <TgOutcomeSection idx={idx} events={notifies} />}
          {results ? (
            <>
              <div className="hist-section-title">
                訊號 lift(~{(results.spanHours / 24).toFixed(1)} 日 · {results.uniqueSlots} 格 · {ERA_LABEL[results.source]})
                {idx && idx.sourcesPresent.length > 1 && (
                  <span className="hist-source-switcher">
                    {(['auto', 'binance', 'okx', 'all'] as EvalSource[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setEvalSrc(s)}
                        aria-pressed={evalSrc === s}
                        className={`hist-source-button${evalSrc === s ? ' active' : ''}`}
                      >
                        {SRC_LABEL[s]}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {results.source === 'all' && idx && idx.sourcesPresent.length > 1 && (
                <div className="muted hist-seam-warning">
                  ⚠️ 混合模式跨 OKX→Binance 遷移 seam,lift 溝埋兩個 regime — 只作對照,唔好當統計。
                </div>
              )}
              <LiftTable results={results} />
            </>
          ) : (
            <div className="card strat-msg">記錄格數不足(需 ≥ 2 格)先計到 lift。</div>
          )}
          <div className="hist-section-title">
            訊號日誌(⚡/蓄 觸發 + TG 發送實錄「TG」chip;📈 增倉突破/micro-scan 卡由 notify log 補齊,點列可開圖)
          </div>
          <SignalJournal rows={journal} onSelect={onSelect} />
          {idx && idx.slots.length > 0 && (
            <>
              <div className="hist-section-title">時間軸回放(拉桿返去任何一格,睇當時嘅強度 top-10)</div>
              <TimelineScrubber idx={idx} onSelect={onSelect} />
            </>
          )}
          {idx && results && (
            <>
              <div className="hist-section-title">Replay 重跑(特徵級 — 自訂門檻 vs 同範圍基準)</div>
              <ReplayPanel idx={idx} results={results} />
            </>
          )}
          <div className="footer muted">
            數字為已記錄特徵嘅事後統計 · 小樣本僅供機制檢查,非投資建議
          </div>
        </>
      )}
    </div>
  );
}
