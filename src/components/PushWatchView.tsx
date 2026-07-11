import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoinLite, ScanSource } from '../types';
import { fmtAge, fmtClock, fmtPct, fmtPrice, strengthCls } from '../lib/format';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';
import Sparkline from './Sparkline';

interface Props {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  coins: CoinLite[];
  source: ScanSource;
  onSelect: (symbol: string) => void;
}

interface PushEvent {
  ts: number;
  sym: string;
  cls: string;
  px: number;
  strength: number;
  via?: 'photo' | 'text';
  delivered?: boolean;
}

interface PushRow {
  sym: string;
  latest: PushEvent;
  count: number;
  classes: string[];
  coin?: CoinLite;
  ret: number | null;
}

const DAY_MS = 24 * 3600 * 1000;
const FETCH_DAYS = 7;
const POLL_MS = 30_000;
const SIGNAL_META: Record<string, { short: string; label: string }> = {
  fb: { short: '⚡ 縮', label: '縮倉突破' },
  rb: { short: '📈 增', label: '增倉突破' },
  vg: { short: '🚀 擴', label: '處女增倉' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtPushTime = (ms: number) => {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return `${sameDay ? '今日' : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`} ${fmtClock(ms)}`;
};

function parsePushEvents(text: string): PushEvent[] {
  const out: PushEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"notify"')) continue;
    try {
      const o = JSON.parse(line) as Partial<PushEvent> & { type?: string };
      // Old v1 logging marked `via:photo` only after at least one Telegram send
      // succeeded; `via:text` was ambiguous because the final fallback result
      // was not captured. Keep only confirmed legacy sends. New logs carry an
      // explicit delivered:true and an accurate photo/text channel.
      const confirmed = o.delivered === true || (o.delivered == null && o.via === 'photo');
      if (
        o.type === 'notify' &&
        confirmed &&
        typeof o.sym === 'string' &&
        typeof o.cls === 'string' &&
        Number.isFinite(o.ts) &&
        Number.isFinite(o.px)
      ) {
        out.push(o as PushEvent);
      }
    } catch {
      /* one malformed JSONL line must not hide the rest of the watchlist */
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export default function PushWatchView({ tab, onTab, coins, source, onSelect }: Props) {
  const [events, setEvents] = useState<PushEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [rangeH, setRangeH] = useState<24 | 168>(24);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const loadedOnce = useRef(false);
  // A progressive full sweep temporarily contains only the batches scanned so
  // far. Preserve the last live row so pushed coins do not blink to "waiting".
  const currentCache = useRef(new Map<string, CoinLite>());
  for (const coin of coins) currentCache.current.set(coin.symbol, coin);

  const load = useCallback(async (signal: AbortSignal) => {
    setRefreshing(true);
    try {
      const now = Date.now();
      const res = await fetch(`/recordings?from=${ymd(now - FETCH_DAYS * DAY_MS)}&to=${ymd(now)}`, { signal });
      if (!res.ok) throw new Error(`recordings http ${res.status}`);
      const parsed = parsePushEvents(await res.text());
      setEvents(parsed);
      setStatus(parsed.length ? 'ready' : 'empty');
      setLoadedAt(Date.now());
      loadedOnce.current = true;
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && !loadedOnce.current) setStatus('error');
    } finally {
      if (!signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const id = setInterval(() => void load(ctrl.signal), POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load, refreshSeq]);

  const windowEvents = useMemo(() => {
    const cutoff = Date.now() - rangeH * 3600_000;
    return events.filter((e) => e.ts >= cutoff);
  }, [events, rangeH]);

  const rows = useMemo<PushRow[]>(() => {
    const grouped = new Map<string, { latest: PushEvent; count: number; classes: Set<string> }>();
    for (const event of windowEvents) {
      const hit = grouped.get(event.sym);
      if (hit) {
        hit.count++;
        hit.classes.add(event.cls);
        if (event.ts > hit.latest.ts) hit.latest = event;
      } else {
        grouped.set(event.sym, { latest: event, count: 1, classes: new Set([event.cls]) });
      }
    }
    return [...grouped.entries()]
      .map(([sym, g]) => {
        const coin = currentCache.current.get(sym);
        const ret = coin && g.latest.px > 0 ? (coin.lastPrice / g.latest.px - 1) * 100 : null;
        return { sym, latest: g.latest, count: g.count, classes: [...g.classes], coin, ret };
      })
      .sort((a, b) => b.latest.ts - a.latest.ts);
  }, [windowEvents, coins]);

  const priced = rows.filter((r) => r.ret != null);
  const winners = priced.filter((r) => (r.ret ?? 0) > 0).length;

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">Telegram 推送監察 · 推送價對而家價</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <div className="push-controls">
        <div className="push-range" role="group" aria-label="推送時間範圍">
          <button type="button" aria-pressed={rangeH === 24} className={rangeH === 24 ? 'active' : ''} onClick={() => setRangeH(24)}>24小時</button>
          <button type="button" aria-pressed={rangeH === 168} className={rangeH === 168 ? 'active' : ''} onClick={() => setRangeH(168)}>7日</button>
        </div>
        <span className={`chip ${source === 'demo' ? 'demo' : 'live'}`}>
          <i className="live-dot" /> {source === 'demo' ? 'DEMO 現價' : 'LIVE 現價'}
        </span>
        <span className="muted push-sync">每30秒讀新推送 · 現價跟掃描更新{loadedAt ? ` · ${fmtClock(loadedAt)}` : ''}</span>
        <button type="button" className="btn ghost" disabled={refreshing} onClick={() => setRefreshSeq((n) => n + 1)}>
          {refreshing ? '更新中…' : '↻ 更新'}
        </button>
      </div>

      {status === 'loading' && (
        <div className="card strat-msg"><div className="spinner" /> 載入 Telegram 推送記錄…</div>
      )}
      {status === 'error' && (
        <div className="card strat-msg">讀取推送記錄失敗 — 需在 dev server 或桌面版內執行。</div>
      )}
      {(status === 'ready' || status === 'empty') && (
        <>
          <div className="push-summary-grid">
            <div className="card push-summary"><span>監察幣</span><strong>{rows.length}</strong></div>
            <div className="card push-summary"><span>TG 推送</span><strong>{windowEvents.length}</strong></div>
            <div className="card push-summary"><span>現價高過推送價</span><strong className={winners ? 'up' : ''}>{winners}/{priced.length}</strong></div>
          </div>

          <div className="card push-table">
            <div className="push-head">
              <span>幣</span>
              <span>訊號</span>
              <span>推送時間</span>
              <span className="ta-r">推送價</span>
              <span className="ta-r">而家價</span>
              <span className="ta-r">推送後</span>
              <span className="ta-r">1h</span>
              <span>24H</span>
              <span className="ta-r">強度</span>
            </div>
            {rows.map((row) => {
              const meta = SIGNAL_META[row.latest.cls] ?? { short: row.latest.cls, label: row.latest.cls };
              return (
                <div
                  key={row.sym}
                  className="push-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.sym)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(row.sym);
                    }
                  }}
                >
                  <span className="push-symbol">
                    <strong>{row.sym}</strong><span className="quote">/USDT</span>
                    {row.count > 1 && <span className="chip mini">×{row.count}</span>}
                  </span>
                  <span>
                    <span className={`push-signal ${row.latest.cls}`} title={meta.label}>{meta.short}</span>
                    {row.classes.length > 1 && <span className="push-multi" title="曾觸發多種推送">+{row.classes.length - 1}</span>}
                  </span>
                  <span className="push-time" title={new Date(row.latest.ts).toLocaleString()}>
                    {fmtPushTime(row.latest.ts)} <small>{fmtAge(row.latest.ts)}</small>
                  </span>
                  <span className="ta-r num">{fmtPrice(row.latest.px)}</span>
                  <span className={`ta-r num ${row.coin ? '' : 'muted'}`}>{row.coin ? fmtPrice(row.coin.lastPrice) : '等掃描'}</span>
                  <span className={`ta-r num ${row.ret == null ? 'muted' : row.ret >= 0 ? 'up' : 'down'}`}>
                    {row.ret == null ? '—' : fmtPct(row.ret, 2)}
                  </span>
                  <span className={`ta-r num ${row.coin ? (row.coin.change1h >= 0 ? 'up' : 'down') : 'muted'}`}>
                    {row.coin ? fmtPct(row.coin.change1h, 2) : '—'}
                  </span>
                  <span className="spark-cell push-spark" title={row.coin ? `24h ${fmtPct(row.coin.change24h)}` : '等候掃描'}>
                    {row.coin ? <Sparkline pts={row.coin.spark} up={row.coin.change24h >= 0} /> : <span className="muted">—</span>}
                  </span>
                  <span className={`ta-r num ${row.coin ? strengthCls(row.coin.strength) : 'muted'}`}>
                    {row.coin?.strength ?? row.latest.strength ?? '—'}
                  </span>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="push-empty muted">近 {rangeH === 24 ? '24 小時' : '7 日'}未有成功 Telegram 推送。</div>
            )}
          </div>
          <div className="push-note muted">以每隻幣最新一次推送價計算；×N 代表範圍內重複推送。點一行可開完整圖表。</div>
        </>
      )}
    </div>
  );
}
