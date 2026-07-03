import { useMemo, type ReactNode } from 'react';
import {
  type Coin,
  type EntryKind,
  type ScanResult,
  type Signals,
  type SignalTimesEntry,
  type Timeframe,
} from '../types';
import { ChartSync } from '../lib/chartSync';
import { aggregateForTf } from '../lib/aggregate';
import { interpret } from '../lib/interpret';
import { fmtAge, fmtClock, fmtMoney, fmtPct, fmtPrice, pctSign, strengthCls } from '../lib/format';
import InsightZone from './InsightZone';
import BrandMark from './BrandMark';
import { RegimeTag } from './RegimeTag';
import { FundingPanel, OIPanel, PricePanel, StrengthPanel } from './ChartPanels';

const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  breakout: '突破位',
  pullback: '回調位',
  reclaim: '收復位',
};

const ENTRY_KIND_NOTE: Record<EntryKind, string> = {
  breakout: '進場採突破確認位（24h 盤整高點）— 等突破企穩或回測不破再進場，勝率好過在區間內猜底。',
  pullback: '進場採回調位（1H EMA20）— 順勢等回吐承接，避免追高；價若遠高於此位，等待而非追價。',
  reclaim: '出貨階段 LONG ONLY 宜觀望 — 所示為收復位，僅在重新站上 24h 高位後再重新評估。',
};

const SIGNAL_LABELS: Array<[keyof Signals, string]> = [
  ['fundsFirst', '低位資金先動'],
  ['mildRise', '1h 溫和抬升'],
  ['oiHealthy', 'OI 健康增加'],
  ['buyHealthy', '主動買盤健康'],
];

function Stat({ label, value, cls }: { label: string; value: ReactNode; cls?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value num ${cls ?? ''}`}>{value}</div>
    </div>
  );
}

function ExitRow({
  tag,
  kind,
  price,
  pct,
}: {
  tag: string;
  kind: 'tp' | 'sl';
  price: string;
  pct: string;
}) {
  return (
    <div className="exit-row">
      <span className={`exit-tag ${kind}`}>{tag}</span>
      <span className="exit-price num">{price}</span>
      <span className={`num ${kind === 'tp' ? 'up' : 'down'}`}>{pct}</span>
    </div>
  );
}

export default function CoinDetail({
  coin,
  scannedAt,
  source,
  tf,
  onTf,
  onBack,
  backLabel = '← 返回掃描列表',
  times,
  pinned,
  onTogglePin,
}: {
  coin: Coin;
  scannedAt: number;
  source: ScanResult['source'];
  times?: SignalTimesEntry;
  tf: Timeframe;
  onTf: (t: Timeframe) => void;
  onBack: () => void;
  backLabel?: string;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const sync = useMemo(() => new ChartSync(), []);
  // aggregate every panel's series to the selected timeframe together, so their
  // bar times stay identical and the shared crosshair/range sync lines up.
  // 1h/4h pull from the coin's 1H long series (weeks of history) when present.
  const view = useMemo(() => aggregateForTf(coin, tf), [coin, tf]);
  // pattern read runs on the raw scan-resolution data, independent of display tf
  const insights = useMemo(() => interpret(coin), [coin]);
  const { plan } = coin;
  const pctFromEntry = (x: number) => fmtPct((x / plan.entry - 1) * 100, 1);

  return (
    <div className="page">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>
          {backLabel}
        </button>
        <div className="top-actions">
          <button
            type="button"
            className={`pin-btn detail${pinned ? ' on' : ''}`}
            title={pinned ? '取消釘選' : '釘選置頂'}
            onClick={onTogglePin}
          >
            📌 {pinned ? '已釘選' : '釘選'}
          </button>
          {source === 'okx' ? (
            <span className="chip live">
              <i className="live-dot" /> LIVE · OKX
            </span>
          ) : (
            <span className="chip demo">DEMO · 模擬</span>
          )}
          <span className="chip" title={source === 'okx' ? '每 20 秒於背景重新拉取此幣種資料' : undefined}>
            {source === 'okx' ? '更新於' : '上次掃描'} {fmtClock(scannedAt)}
          </span>
        </div>
      </div>

      <header className="card detail-header">
        <div className="dh-left">
          <BrandMark size={40} />
          <div>
            <div className="dh-title">
              {coin.symbol}
              <span className="quote">/USDT</span>
            </div>
            <div className="dh-status">
              <RegimeTag regime={coin.regime} />
              <span className="muted">·</span>
              <span className="dh-longonly">LONG ONLY</span>
              <span className="muted">·</span>
              <span>強度 {coin.strength}</span>
              {times?.top10 && (
                <span className="age-chip" title="首次進入強度 TOP 10 至今">
                  TOP10 已 {fmtAge(times.top10)}
                </span>
              )}
              {times?.fb && (
                <span className="age-chip fb" title="縮倉突破訊號亮起至今">
                  ⚡ 已 {fmtAge(times.fb)}
                </span>
              )}
              {times?.ea && (
                <span className="age-chip ea" title="早期蓄力訊號亮起至今">
                  蓄 已 {fmtAge(times.ea)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="dh-badges">
          <Stat label="強度" value={coin.strength} cls={strengthCls(coin.strength)} />
          <Stat label="1H" value={fmtPct(coin.change1h)} cls={pctSign(coin.change1h) >= 0 ? 'up' : 'down'} />
          <Stat label="量Z" value={coin.volZ.toFixed(1)} />
          <Stat label="OI 4h" value={fmtPct(coin.oi4h, 1)} cls={pctSign(coin.oi4h, 1) >= 0 ? 'up' : 'down'} />
          <Stat label={`進場·${ENTRY_KIND_LABEL[plan.kind]}`} value={fmtPrice(plan.entry)} />
          <Stat label="24h量" value={fmtMoney(coin.vol24h)} />
        </div>
      </header>

      <InsightZone insights={insights} />

      <PricePanel coin={view} sync={sync} tf={tf} onTf={onTf} />
      <OIPanel coin={view} sync={sync} tf={tf} />
      <FundingPanel coin={view} sync={sync} tf={tf} />
      <StrengthPanel coin={view} sync={sync} tf={tf} />

      <div className="signal-strip">
        {SIGNAL_LABELS.map(([key, label]) => (
          <span key={key} className={coin.signals[key] ? 'sig lit' : 'sig dim'}>
            <i className="sig-dot" />
            {label}
          </span>
        ))}
      </div>

      <div className="bottom-grid">
        <section className="card sub-card">
          <div className="sub-head">
            風險旗標
            {coin.riskFlags.length > 0 && <span className="risk-badge">⚠ {coin.riskFlags.length}</span>}
          </div>
          {coin.riskFlags.length === 0 ? (
            <div className="muted empty">本次掃描未觸發風險旗標</div>
          ) : (
            <ul className="risk-list">
              {coin.riskFlags.map((f) => (
                <li key={f}>⚠ {f}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="card sub-card">
          <div className="sub-head">
            出場計畫 <span className="chip mini">LONG ONLY</span>
          </div>
          <div className="exit-rows">
            <ExitRow tag="TP1" kind="tp" price={fmtPrice(plan.tp1)} pct={pctFromEntry(plan.tp1)} />
            <ExitRow tag="TP2" kind="tp" price={fmtPrice(plan.tp2)} pct={pctFromEntry(plan.tp2)} />
            <ExitRow tag="TP3" kind="tp" price={fmtPrice(plan.tp3)} pct={pctFromEntry(plan.tp3)} />
            <ExitRow tag="硬停損" kind="sl" price={fmtPrice(plan.sl)} pct={pctFromEntry(plan.sl)} />
            <div className="exit-note">{ENTRY_KIND_NOTE[plan.kind]}</div>
            <div className="exit-note">
              Runner · 保留 {plan.runnerPct}% 部位，移動停損讓利潤延伸
            </div>
          </div>
        </section>
      </div>

      <div className="footer">
        {source === 'okx'
          ? '資料來源 OKX USDT 永續 · 實時 · 圖表 lightweight-charts'
          : '資料來源 模擬資料（demo）· 圖表 lightweight-charts'}
        <span className="muted"> · 強度與階段為示範性評分，非投資建議</span>
      </div>
    </div>
  );
}
