import { useEffect, useRef, useState } from 'react';
import type { CoinLite, ScanSource, SearchHit } from '../types';
import { searchPerps } from '../data/scan';
import { fmtMoney, fmtPct, fmtPrice, pctSign } from '../lib/format';

interface Props {
  source: ScanSource;
  scanCoins: CoinLite[];
  query: string; // lives in App so it survives closing/reopening
  onQuery: (q: string) => void;
  onPick: (symbol: string) => void; // App.openCoin handles scan-cached vs live fetch
  onClose: () => void;
  fetching: string | null;
  pinned: Set<string>;
  onTogglePin: (symbol: string) => void;
}

// demo fallback: search the local scan list only
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

// Pop-up command-bar style search: overlays whatever view is open, autofocuses,
// closes on Esc / backdrop click. Same search + row logic as the old full-page
// SearchView, just floated.
export default function SearchBar({
  source,
  scanCoins,
  query,
  onQuery,
  onPick,
  onClose,
  fetching,
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
    inputRef.current?.select();
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
    <div className="search-pop-backdrop" onClick={onClose}>
      <div className="search-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="搜尋幣種">
        <input
          ref={inputRef}
          className="search-input search-pop-input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          placeholder={source === 'okx' ? '搜尋任何 OKX USDT 永續,如 TRUMP、PENGU、DOGE…' : '搜尋掃描列表…'}
          spellCheck={false}
          autoComplete="off"
        />

        <div className="search-pop-results">
          {hits.map((h) => {
            const inScan = scanSet.has(h.base);
            const busy = fetching === h.base;
            return (
              <div
                key={h.instId}
                className="sr-row"
                role="button"
                tabIndex={0}
                onClick={() => onPick(h.base)}
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
                <span className={`ta-r num ${pctSign(h.change24h) >= 0 ? 'up' : 'down'}`}>{fmtPct(h.change24h)}</span>
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
          {err && <div className="sr-empty muted">搜尋失敗（{err}），請重試。</div>}
          {!loading && !err && hits.length === 0 && (
            <div className="sr-empty muted">
              {query.trim() ? `找不到符合「${query}」的 USDT 永續` : '輸入幣種符號開始搜尋'}
            </div>
          )}
          {loading && hits.length === 0 && <div className="sr-empty muted">搜尋中…</div>}
        </div>

        <div className="search-pop-foot muted">
          {source === 'okx' ? 'OKX 全部 USDT 永續 · 點擊即時拉取分析 · Esc 關閉' : 'DEMO 模式 · 僅搜尋掃描列表 · Esc 關閉'}
        </div>
      </div>
    </div>
  );
}
