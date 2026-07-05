import type { CoinLite, ScanProgress, ScanResult, SignalTimes, SignalTimesEntry } from '../types';
import type { PaperState } from '../lib/paper';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';
import PaperChip from './PaperChip';
import { RegimeTag } from './RegimeTag';
import Sparkline from './Sparkline';
import { fmtAge, fmtClock, fmtMoney, fmtPct, pctSign, strengthCls } from '../lib/format';

interface Props {
  scan: ScanResult;
  loading: boolean;
  loadErr?: string;
  progress: ScanProgress | null;
  fbOnly: boolean;
  onFbToggle: () => void;
  paper: PaperState | null;
  sigTimes: SignalTimes;
  pinned: Set<string>;
  onTogglePin: (symbol: string) => void;
  tab: AppTab;
  onTab: (t: AppTab) => void;
  onSelect: (symbol: string) => void;
  onRefresh: () => void;
}

function SourceChip({ source }: { source: ScanResult['source'] }) {
  if (source === 'okx') {
    return (
      <span className="chip live" title="OKX USDT 永續實時資料">
        <i className="live-dot" /> LIVE · OKX
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

function Row({
  c,
  t,
  isTop10,
  pinned,
  onTogglePin,
  onClick,
}: {
  c: CoinLite;
  t?: SignalTimesEntry;
  isTop10: boolean;
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
        {c.flushBreakout && (
          <span className="fb-badge" title="縮倉突破 — 回測 lift ×2 訊號進行中">
            ⚡{t?.fb ? <span className="sig-age">{fmtAge(t.fb)}</span> : null}
          </span>
        )}
        {!c.flushBreakout && c.earlyAccum && (
          <span className="ea-badge" title="早期蓄力 — 觀察名單級（回測 lift ×1.0-1.2），非進場訊號">
            蓄{t?.ea ? <span className="sig-age">{fmtAge(t.ea)}</span> : null}
          </span>
        )}
        {c.spotPump && (
          <span className="sp-badge" title="現貨帶動 — 現貨量Z 驅動的拉升（回測 lift ×1.79），排序參考，非進場訊號">
            現
          </span>
        )}
        {isTop10 && t?.top10 ? (
          <span className="age-chip" title="首次進入強度 TOP 10 至今">
            T10 {fmtAge(t.top10)}
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
      <span className={`ta-r num ${pctSign(c.oi4h, 1) >= 0 ? 'up' : 'down'}`}>{fmtPct(c.oi4h, 1)}</span>
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
  paper,
  sigTimes,
  pinned,
  onTogglePin,
  tab,
  onTab,
  onSelect,
  onRefresh,
}: Props) {
  const filtered = fbOnly ? scan.coins.filter((c) => c.flushBreakout) : scan.coins;
  // pinned coins float to the top; each group keeps its incoming strength order
  const rows = [
    ...filtered.filter((c) => pinned.has(c.symbol)),
    ...filtered.filter((c) => !pinned.has(c.symbol)),
  ];
  // top-10 by rank in the full (unfiltered) strength-sorted list
  const top10 = new Set(scan.coins.slice(0, 10).map((c) => c.symbol));

  return (
    <div className="page">
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
            className={`fb-toggle${fbOnly ? ' on' : ''}`}
            onClick={onFbToggle}
            title="只顯示縮倉突破訊號（回測 154 幣 37 日：命中率 9.1% vs 4.5%，lift ×2.0）"
            aria-pressed={fbOnly}
          >
            ⚡ 縮倉突破
          </button>
          <SourceChip source={scan.source} />
          <PaperChip paper={paper} />
          {/* fixed-width slot, reserved even when idle, so the row never reflows */}
          <span className="chip num scan-count" style={progress ? undefined : { visibility: 'hidden' }}>
            掃描 {progress ? `${progress.done}/${progress.total}` : '0/0'}
          </span>
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
          無法連線 OKX（{loadErr ?? '網路或地區限制'}），目前顯示模擬資料。
        </div>
      ) : loadErr ? (
        <div className="notice">本次更新失敗（{loadErr}），顯示上次成功的資料。</div>
      ) : null}

      <div className="card table-card">
        <div className="scr-head">
          <span>幣種</span>
          <span>24h</span>
          <span>階段</span>
          <span>強度</span>
          <span className="ta-r">1h</span>
          <span className="ta-r">OI 4h</span>
          <span className="ta-r">Funding</span>
          <span className="ta-r">24h 量</span>
          <span className="ta-r">風險</span>
        </div>
        {rows.map((c) => (
          <Row
            key={c.symbol}
            c={c}
            t={sigTimes[c.symbol]}
            isTop10={top10.has(c.symbol)}
            pinned={pinned.has(c.symbol)}
            onTogglePin={() => onTogglePin(c.symbol)}
            onClick={() => onSelect(c.symbol)}
          />
        ))}
        {fbOnly && rows.length === 0 && (
          <div className="sr-empty muted">
            目前沒有縮倉突破訊號。此訊號稀少屬正常 — 回測 37 日、154 隻幣僅出現 55 次。
          </div>
        )}
      </div>

      <div className="footer">
        {scan.source === 'okx'
          ? '資料來源 OKX USDT 永續 · 實時 · 連續掃描（一輪完即接下一輪）· 記錄每 15 分鐘一格'
          : '資料來源 模擬資料（demo）· 連續掃描'}
        <span className="muted"> · 強度為示範性評分，非投資建議</span>
      </div>
    </div>
  );
}
