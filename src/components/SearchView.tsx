import { useEffect, useRef, useState } from 'react';
import type { CoinLite, ScanSource, SearchHit } from '../types';
import { searchPerps } from '../data/scan';
import { fmtMoney, fmtPct, fmtPrice, pctSign } from '../lib/format';
import BrandMark from './BrandMark';
import NavTabs, { type AppTab } from './NavTabs';

interface Props {
  source: ScanSource;
  scanCoins: CoinLite[];
  tab: AppTab;
  onTab: (t: AppTab) => void;
  query: string; // lives in App so it survives opening a detail view
  onQuery: (q: string) => void;
  onPickScan: (symbol: string) => void; // coin already in the scan — open instantly
  onPickLive: (hit: SearchHit) => void; // fetch on demand
  fetching: string | null; // symbol currently being fetched
  fetchErr?: string;
  pinned: Set<string>;
  onTogglePin: (symbol: string) => void;
}

// demo fallback: search over the local scan list only
function demoHits(coins: CoinLite[], q: string): SearchHit[] {
  const Q = q.trim().toUpperCase();
  return coins
    .filter((c) => !Q || c.symbol.includes(Q))
    .map((c) => ({
      instId: `${c.symbol}-USDT-SWAP`,
      base: c.symbol,
      last: c.lastPrice,
      change24h: c.change24h,
      vol24hUsd: c.vol24h,
    }));
}

export default function SearchView({
  source,
  scanCoins,
  tab,
  onTab,
  query,
  onQuery,
  onPickScan,
  onPickLive,
  fetching,
  fetchErr,
  pinned,
  onTogglePin,
}: Props) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const scanSet = new Set(scanCoins.map((c) => c.symbol));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (source !== 'okx') {
      setHits(demoHits(scanCoins, query));
      return;
    }
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(() => {
      searchPerps(query)
        .then((h) => {
          if (cancelled) return;
          setHits(h);
          setErr(undefined);
          setLoading(false);
        })
        .catch((e) => {
          if (cancelled) return;
          setErr(e instanceof Error ? e.message : String(e));
          setLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, source, scanCoins]);

  return (
    <div className="page">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">
              {source === 'okx' ? '搜尋全部 OKX USDT 永續' : '搜尋掃描列表（DEMO 模式）'}
            </div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>

      <input
        ref={inputRef}
        className="search-input"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={source === 'okx' ? '輸入幣種符號，如 TRUMP、PENGU、DOGE…' : '輸入幣種符號…'}
        spellCheck={false}
        autoComplete="off"
      />

      {fetchErr && <div className="notice">{fetchErr}</div>}
      {err && <div className="notice">搜尋失敗（{err}），請重試。</div>}

      <div className="card table-card">
        <div className="sr-head">
          <span>幣種</span>
          <span className="ta-r">最新價</span>
          <span className="ta-r">24h 漲跌</span>
          <span className="ta-r">24h 量</span>
          <span className="ta-r"></span>
        </div>
        {hits.map((h) => {
          const inScan = scanSet.has(h.base);
          const busy = fetching === h.base;
          return (
            <div
              key={h.instId}
              className="sr-row"
              role="button"
              tabIndex={0}
              onClick={() => (inScan ? onPickScan(h.base) : onPickLive(h))}
            >
              <span className="sym">
                <button
                  type="button"
                  className={`pin-btn${pinned.has(h.base) ? ' on' : ''}`}
                  title={pinned.has(h.base) ? '取消釘選' : '釘選置頂'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(h.base);
                  }}
                >
                  📌
                </button>
                {h.base}
                <span className="quote">/USDT</span>
              </span>
              <span className="ta-r num">{fmtPrice(h.last)}</span>
              <span className={`ta-r num ${pctSign(h.change24h) >= 0 ? 'up' : 'down'}`}>
                {fmtPct(h.change24h)}
              </span>
              <span className="ta-r num">{fmtMoney(h.vol24hUsd)}</span>
              <span className="ta-r">
                {busy ? (
                  <span className="muted">拉取中…</span>
                ) : inScan ? (
                  <span className="chip mini in-scan">掃描中</span>
                ) : (
                  <span className="muted">→</span>
                )}
              </span>
            </div>
          );
        })}
        {!loading && hits.length === 0 && (
          <div className="sr-empty muted">找不到符合「{query}」的 USDT 永續</div>
        )}
        {loading && hits.length === 0 && <div className="sr-empty muted">搜尋中…</div>}
      </div>

      <div className="footer">
        {source === 'okx'
          ? '搜尋範圍：OKX 全部 USDT 永續 · 點擊即時拉取 48h 資料並分析'
          : 'DEMO 模式：僅搜尋目前掃描列表'}
      </div>
    </div>
  );
}
