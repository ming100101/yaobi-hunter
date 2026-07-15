import { useEffect, useMemo, useState } from 'react';
import type {
  CoinLite,
  Regime,
  ScanProgress,
  ScanResult,
  ScreenerSortDir,
  ScreenerSortKey,
  SignalTimes,
  SignalTimesEntry,
  ThemeName,
} from '../types';
import type { PaperState } from '../lib/paper';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';
import PaperChip from './PaperChip';
import { RegimeTag, REGIME_META } from './RegimeTag';
import Sparkline from './Sparkline';
import { fmtAge, fmtClock, fmtMoney, fmtPct, pctSign, strengthCls } from '../lib/format';
import { top10Ranks } from '../lib/rank';
import { EARLY_PUMP_SHIPPED, IGNITION_SHIPPED } from '../lib/analyze'; // S14 badge gate (false); 5m 點火 badge gate (true, 2026-07-09)
import { kvGet, kvSet } from '../data/cache';
import HelpModal from './HelpModal';
import { SIGNAL_EVIDENCE_COPY } from '../lib/evidenceCopy';

interface Props {
  scan: ScanResult;
  loading: boolean;
  loadErr?: string;
  progress: ScanProgress | null;
  fbOnly: boolean;
  onFbToggle: () => void;
  sortKey: ScreenerSortKey;
  sortDir: ScreenerSortDir;
  onSort: (k: ScreenerSortKey) => void;
  regimeSet: Set<Regime>;
  onRegimeToggle: (r: Regime) => void;
  minVol: number;
  onMinVol: (v: number) => void;
  paper: PaperState | null;
  sigTimes: SignalTimes;
  pinned: Set<string>;
  onTogglePin: (symbol: string) => void;
  tab: AppTab;
  onTab: (t: AppTab) => void;
  onSelect: (symbol: string) => void;
  onRefresh: () => void;
  theme: ThemeName;
  onToggleTheme: () => void;
}

function SourceChip({ source }: { source: ScanResult['source'] }) {
  if (source !== 'demo') {
    return (
      <span className="chip live" title="Binance USDT 永續實時資料">
        <i className="live-dot" /> LIVE · Binance
      </span>
    );
  }
  return (
    <span className="chip demo" title="無法連線交易所，改用模擬資料">
      DEMO · 模擬
    </span>
  );
}

function fundingCls(f: number): string {
  if (f > 0.03) return 'down';
  if (f < 0) return 'up';
  return 'muted';
}

// A clickable column header (button semantics + aria-sort). `r` = right-aligned
// numeric column. The ▼/▲ indicator shows on the active column only.
function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  r,
}: {
  label: string;
  k: ScreenerSortKey;
  sortKey: ScreenerSortKey;
  sortDir: ScreenerSortDir;
  onSort: (k: ScreenerSortKey) => void;
  r?: boolean;
}) {
  const active = sortKey === k;
  return (
    <span
      className={r ? 'ta-r' : undefined}
      aria-sort={active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button type="button" className={`sort-h${active ? ' active' : ''}`} onClick={() => onSort(k)}>
        {label}
        {active ? <span className="sort-ind">{sortDir === 'desc' ? '▼' : '▲'}</span> : null}
      </button>
    </span>
  );
}

function Row({
  c,
  t,
  top10Rank,
  pinned,
  onTogglePin,
  onClick,
}: {
  c: CoinLite;
  t?: SignalTimesEntry;
  top10Rank?: number; // 1-based current strength rank, present only while in the top-10
  pinned: boolean;
  onTogglePin: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className={`scr-row${pinned ? ' pinned' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span className="sym">
        <button
          type="button"
          className={`pin-btn${pinned ? ' on' : ''}`}
          title={pinned ? '取消釘選' : '釘選置頂'}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
        >
          📌
        </button>
        {c.symbol}
        <span className="quote">/USDT</span>
        {IGNITION_SHIPPED && c.igniting && (
          <span className="ign-badge" title="🔥 5分鐘點火 — 而家正喺 5m clock 上面點火(近15分鐘 +≥6% + 成交爆 ≥3×)。呢個係實時 ramp,通常早過 1H 偵測 15-55 分鐘(SKYAI 覆核:5m +6% vs 1H +42%)。Badge 級,通知未開(等 false-positive 量度)。">
            🔥點火
          </span>
        )}
        {c.flushBreakout && (
          <span className="fb-badge" title={SIGNAL_EVIDENCE_COPY.flushBreakout.badge}>
            ⚡{t?.fb ? <span className="sig-age">{fmtAge(t.fb)}</span> : null}
          </span>
        )}
        {!c.flushBreakout && c.earlyAccum && (
          <span className="ea-badge" title={SIGNAL_EVIDENCE_COPY.earlyAccum.badge}>
            蓄{t?.ea ? <span className="sig-age">{fmtAge(t.ea)}</span> : null}
          </span>
        )}
        {c.spotPump && (
          <span className="sp-badge" title={SIGNAL_EVIDENCE_COPY.spotPump.badge}>
            現
          </span>
        )}
        {c.virginBreakout && !c.flushBreakout && !c.rebuildBreakout && (
          <span className="sp-badge" title={SIGNAL_EVIDENCE_COPY.virginBreakout.badge}>
            擴
          </span>
        )}
        {c.rebuildBreakout && !c.flushBreakout && (
          <span className="sp-badge" title={SIGNAL_EVIDENCE_COPY.rebuildBreakout.badge}>
            增
          </span>
        )}
        {EARLY_PUMP_SHIPPED && c.earlyPump && !c.flushBreakout && !c.rebuildBreakout && !c.virginBreakout && (
          <span className="sp-badge" title="早期拉盤 — 突破前 markup。仍在 recording-only(對抗式覆核證原 ×1.73 主要係 geometry artifact,真增量 ×1.03-1.10,expectancy ~0),未出 badge/通知。">
            早
          </span>
        )}
        {top10Rank != null && t?.top10 ? (
          <span
            className="age-chip"
            title="現時強度排名(同分以 24h 量、字母序決定)· 時間 = 連續在強度 TOP 10 內幾耐"
          >
            T10 #{top10Rank} · {fmtAge(t.top10)}
          </span>
        ) : null}
      </span>
      <span className="spark-cell" title={`24h ${fmtPct(c.change24h)}`}>
        <Sparkline pts={c.spark} up={c.change24h >= 0} />
      </span>
      <span>
        <RegimeTag regime={c.regime} />
      </span>
      <span className="strength-cell">
        <span className={`strength-num ${strengthCls(c.strength)}`}>{c.strength}</span>
        <span className="strength-bar">
          <span className="strength-fill" style={{ width: `${c.strength}%`, display: 'block' }} />
        </span>
      </span>
      <span className={`ta-r num ${pctSign(c.change1h) >= 0 ? 'up' : 'down'}`}>{fmtPct(c.change1h)}</span>
      <span
        className={`ta-r num ${c.oiTrusted === false ? 'muted' : pctSign(c.oi4h, 1) >= 0 ? 'up' : 'down'}`}
        title={c.oiTrusted === false ? 'OI 資料滯後（冷路徑）' : undefined}
      >
        {fmtPct(c.oi4h, 1)}
      </span>
      <span className={`ta-r num ${fundingCls(c.funding)}`}>{fmtPct(c.funding, 3)}</span>
      <span className="ta-r num">{fmtMoney(c.vol24h)}</span>
      <span className="ta-r">
        {c.riskFlags.length > 0 ? (
          <span className="risk-badge">⚠ {c.riskFlags.length}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </span>
    </div>
  );
}

export default function ScreenerList({
  scan,
  loading,
  loadErr,
  progress,
  fbOnly,
  onFbToggle,
  sortKey,
  sortDir,
  onSort,
  regimeSet,
  onRegimeToggle,
  minVol,
  onMinVol,
  paper,
  sigTimes,
  pinned,
  onTogglePin,
  tab,
  onTab,
  onSelect,
  onRefresh,
  theme,
  onToggleTheme,
}: Props) {
  // filter (⚡/regime/vol compose with AND) → column sort → pinned-first. One
  // memo so batch updates and sort/filter changes re-order the same way (rows
  // don't jump differently than today's per-batch re-sort).
  const rows = useMemo(() => {
    let list = scan.coins;
    if (fbOnly) list = list.filter((c) => c.flushBreakout);
    if (regimeSet.size) list = list.filter((c) => regimeSet.has(c.regime));
    if (minVol > 0) list = list.filter((c) => c.vol24h >= minVol);
    const dir = sortDir === 'desc' ? -1 : 1;
    const sorted = [...list].sort(
      (a, b) => (a[sortKey] - b[sortKey]) * dir || a.symbol.localeCompare(b.symbol),
    );
    // pinned first (user's explicit choice), then 🔥 igniting coins floated to the
    // top so the real-time 點火 badge is actually seen (else a rank-#200 ignition is
    // invisible, defeating the alert). Igniting is rare (~1-2) so this barely disturbs
    // the sort, and auto-reverts when nothing's igniting.
    const unpinned = sorted.filter((c) => !pinned.has(c.symbol));
    return [
      ...sorted.filter((c) => pinned.has(c.symbol)),
      ...(IGNITION_SHIPPED ? unpinned.filter((c) => c.igniting) : []),
      ...unpinned.filter((c) => !(IGNITION_SHIPPED && c.igniting)),
    ];
  }, [scan.coins, fbOnly, regimeSet, minVol, sortKey, sortDir, pinned]);
  const ignitingCount = useMemo(
    () => (IGNITION_SHIPPED ? scan.coins.filter((c) => c.igniting).length : 0),
    [scan.coins],
  );
  // THE top-10 (lib/rank — strength desc, vol24h desc, symbol asc) over the full
  // unfiltered list. Pre-fix this gated on scan.coins.slice(0,10), which is SCAN
  // order, not strength order — chips appeared on the wrong coins.
  const top10 = useMemo(() => top10Ranks(scan.coins), [scan.coins]);

  // U3: help modal + first-run auto-open (once, guarded by the kv 'help-seen' key)
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void kvGet<number>('help-seen').then((seen) => {
      if (!cancelled && !seen) {
        setHelpOpen(true);
        void kvSet('help-seen', Date.now());
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">全市場滾動掃描 · Binance 上架 USDT-Perp · LONG ONLY</div>
          </div>
        </div>
        <div className="top-actions">
          <NavTabs tab={tab} onTab={onTab} />
          <button
            type="button"
            className="btn ghost"
            onClick={() => setHelpOpen(true)}
            title="使用說明"
            aria-label="使用說明"
          >
            ?
          </button>
          <button
            type="button"
            className={`btn ghost${theme === 'y2k' ? ' on' : ''}`}
            onClick={onToggleTheme}
            title="🎀 Y2K 主題（純外觀，唔影響任何數據/訊號）"
            aria-pressed={theme === 'y2k'}
          >
            🎀
          </button>
          <button
            type="button"
            className={`fb-toggle${fbOnly ? ' on' : ''}`}
            onClick={onFbToggle}
            title={SIGNAL_EVIDENCE_COPY.flushBreakout.filter}
            aria-pressed={fbOnly}
          >
            ⚡ 縮倉突破
          </button>
          {(['accumulate', 'pump', 'distribute'] as const).map((rg) => (
            <button
              key={rg}
              type="button"
              className={`fb-toggle${regimeSet.has(rg) ? ' on' : ''}`}
              onClick={() => onRegimeToggle(rg)}
              aria-pressed={regimeSet.has(rg)}
              title={`只顯示${REGIME_META[rg].label}階段（多選；全部關 = 顯示全部）`}
            >
              {REGIME_META[rg].label}
            </button>
          ))}
          <select
            className="vol-select"
            value={minVol}
            onChange={(e) => onMinVol(Number(e.target.value))}
            title="最低 24h 成交量"
          >
            <option value={0}>全部量</option>
            <option value={5_000_000}>≥$5M</option>
            <option value={20_000_000}>≥$20M</option>
            <option value={50_000_000}>≥$50M</option>
          </select>
          <SourceChip source={scan.source} />
          <PaperChip paper={paper} />
          {/* fixed-width slot, reserved even when idle, so the row never reflows */}
          <span className="chip num scan-count" style={progress ? undefined : { visibility: 'hidden' }}>
            掃描 {progress ? `${progress.done}/${progress.total}` : '0/0'}
          </span>
          {ignitingCount > 0 && (
            <span className="chip ign-chip" title="而家正喺 5m clock 上面點火嘅幣數(近15分鐘 +≥6% + 成交爆 ≥3×)。已置頂,望名單頂就見到 🔥 badge。">
              🔥 {ignitingCount} 點火
            </span>
          )}
          <span className="chip last-chip">上次掃描 {fmtClock(scan.scannedAt)}</span>
          <span className={`chip cont-chip${loading ? ' on' : ''}`} title="一輪掃描完即接下一輪，唔等 15 分鐘">
            <i className="live-dot" /> 連續掃描
          </span>
          <button className="btn" onClick={onRefresh} disabled={loading}>
            {loading ? '掃描中…' : '↻ 重新掃描'}
          </button>
        </div>
      </div>

      {scan.source === 'demo' ? (
        <div className="notice">
          無法連線 Binance（{loadErr ?? '網路或地區限制'}），目前顯示模擬資料。
        </div>
      ) : loadErr ? (
        <div className="notice">本次更新失敗（{loadErr}），顯示上次成功的資料。</div>
      ) : null}

      <div className="card table-card">
        <div className="scr-head">
          <span>幣種</span>
          <span>24h</span>
          <span>階段</span>
          <SortHeader label="強度" k="strength" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="1h" k="change1h" r sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="OI 4h" k="oi4h" r sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Funding" k="funding" r sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="24h 量" k="vol24h" r sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          <span className="ta-r">風險</span>
        </div>
        {rows.map((c) => (
          <Row
            key={c.symbol}
            c={c}
            t={sigTimes[c.symbol]}
            top10Rank={top10.get(c.symbol)}
            pinned={pinned.has(c.symbol)}
            onTogglePin={() => onTogglePin(c.symbol)}
            onClick={() => onSelect(c.symbol)}
          />
        ))}
        {rows.length === 0 && (
          <div className="sr-empty muted">
            {fbOnly
              ? SIGNAL_EVIDENCE_COPY.flushBreakout.empty
              : '沒有符合篩選條件的幣。'}
          </div>
        )}
      </div>

      <div className="footer">
        {scan.source !== 'demo'
          ? '資料來源 Binance USDT 永續 · 實時 · 連續掃描（一輪完即接下一輪）· 記錄每 15 分鐘一格'
          : '資料來源 模擬資料（demo）· 連續掃描'}
        <span className="muted"> · 強度為示範性評分，非投資建議</span>
      </div>
    </div>
  );
}
