import { useEffect, useRef, useState } from 'react';
import type {
  Coin,
  CoinLite,
  ScanProgress,
  ScanResult,
  SearchHit,
  SignalTimes,
  Timeframe,
} from './types';
import { fetchFullCoin, getCachedFull, startScan } from './data/scan';
import {
  loadCachedScan,
  loadPinned,
  loadRecentViewed,
  loadSignalTimes,
  savePinned,
  saveCachedScan,
  saveRecentViewed,
  saveSignalTimes,
} from './data/cache';
import { initNotifications, notifyNewSignals } from './lib/notify';
import ScreenerList from './components/ScreenerList';
import CoinDetail from './components/CoinDetail';
import SearchView from './components/SearchView';
import BrandMark from './components/BrandMark';
import type { AppTab } from './components/NavTabs';

const SCAN_MS = 15 * 60 * 1000;
const COIN_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const DETAIL_LIVE_MS = 20 * 1000;
const RECENT_MAX = 20;

function sortLite(coins: CoinLite[]): CoinLite[] {
  return [...coins].sort(
    (a, b) => b.strength - a.strength || a.symbol.localeCompare(b.symbol),
  );
}

export default function App() {
  const [nonce, setNonce] = useState(0);
  const [scanAt, setScanAt] = useState(() => Date.now());
  const [tab, setTab] = useState<AppTab>('scan');
  // K-line timeframe lives here so it persists across detail remounts
  const [tf, setTf] = useState<Timeframe>('15m');

  const [scan, setScan] = useState<ScanResult | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | undefined>();
  // ⚡ 縮倉突破 filter — show only coins where the backtested trigger is live
  const [fbOnly, setFbOnly] = useState(false);

  // open detail view (full-series coin, fetched on demand)
  const [detail, setDetail] = useState<{ coin: Coin; at: number; origin: AppTab } | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchErr, setFetchErr] = useState<string | undefined>();
  const [query, setQuery] = useState('');

  const [, setTick] = useState(0);

  // when each coin first entered top-10 / first fired ⚡ / first fired 蓄
  const [sigTimes, setSigTimes] = useState<SignalTimes>({});
  const sigTimesRef = useRef<SignalTimes>({});

  // user-pinned symbols — explicit choice, always float to the top of the list
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const pinnedRef = useRef<string[]>([]); // insertion order, for priority-fetch

  // mirrors `loading` for the interval closure below
  const loadingRef = useRef(true);
  loadingRef.current = loading;

  const recentRef = useRef<string[]>([]);
  const scanGen = useRef(0);
  const wantDetail = useRef<string | null>(null);
  const lastCoinFetch = useRef<Record<string, number>>({});
  // stable handle for notification clicks (openCoin is recreated per render)
  const openCoinRef = useRef<(symbol: string) => void>(() => {});

  // hydrate from IndexedDB: cached scan renders instantly, refresh runs behind
  useEffect(() => {
    let cancelled = false;
    initNotifications();
    loadRecentViewed().then((r) => {
      if (!cancelled) recentRef.current = r;
    });
    loadPinned().then((p) => {
      if (!cancelled) {
        pinnedRef.current = p;
        setPinned(new Set(p));
      }
    });
    loadCachedScan().then((cached) => {
      if (!cancelled && cached) setScan((prev) => prev ?? cached);
    });
    loadSignalTimes().then((t) => {
      if (!cancelled && t) {
        sigTimesRef.current = t;
        setSigTimes(t);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Continuous-presence signal ages: a timestamp is set when a coin enters a
  // state (top-10 / ⚡ / 蓄) and cleared when it leaves, so the displayed age
  // is "how long has this been live". Updated only when a sweep completes —
  // mid-sweep top-10 membership is meaningless while the list is still filling.
  const updateSignalTimes = (coins: CoinLite[]) => {
    const now = Date.now();
    const sorted = [...coins].sort(
      (a, b) => b.strength - a.strength || a.symbol.localeCompare(b.symbol),
    );
    const top10 = new Set(sorted.slice(0, 10).map((c) => c.symbol));
    const next: SignalTimes = {};
    for (const c of coins) {
      const prev = sigTimesRef.current[c.symbol] ?? {};
      const e: SignalTimes[string] = {};
      if (top10.has(c.symbol)) e.top10 = prev.top10 ?? now;
      if (c.flushBreakout) e.fb = prev.fb ?? now;
      if (c.earlyAccum) e.ea = prev.ea ?? now;
      if (e.top10 || e.fb || e.ea) next[c.symbol] = e;
    }
    sigTimesRef.current = next;
    setSigTimes(next);
    void saveSignalTimes(next);
  };

  // rolling scan on first load, each 15-min slot rollover, and manual refresh
  useEffect(() => {
    const gen = ++scanGen.current;
    setLoading(true);
    setProgress(null);
    // pinned symbols fetch first, then recently-viewed — de-duped, pin order preserved
    const priority = [...new Set([...pinnedRef.current, ...recentRef.current])];
    const handle = startScan(scanAt, nonce, priority, (coins, prog, source) => {
      if (scanGen.current !== gen) return;
      setProgress(prog);
      // toast newly-fired ⚡ signals as each batch lands (live data only)
      if (source === 'okx') {
        void notifyNewSignals(coins, (sym) => openCoinRef.current(sym));
        if (prog && prog.done === prog.total) updateSignalTimes(coins);
      }
      setScan((prev) => {
        // never let a demo fallback overwrite real (cached/previous) data
        if (source === 'demo' && prev && prev.source === 'okx') return prev;
        return { coins: sortLite(coins), scannedAt: scanAt, source };
      });
    });
    handle.promise.then(({ error }) => {
      if (scanGen.current !== gen) return;
      setLoadErr(error);
      setLoading(false);
      setProgress(null);
      if (!error) {
        setScan((prev) => {
          if (prev && prev.source === 'okx') void saveCachedScan(prev);
          return prev;
        });
      }
    });
    return () => {
      handle.abort();
    };
  }, [scanAt, nonce]);

  // countdown tick; rescan when a 15-min slot rolls over — but never abort a
  // sweep that's still running (a sweep crossing a slot boundary used to get
  // killed and restarted, so slow environments could NEVER finish one; the
  // rollover now waits for the sweep to complete first)
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (loadingRef.current) return;
      const now = Date.now();
      setScanAt((prev) => (Math.floor(now / SCAN_MS) !== Math.floor(prev / SCAN_MS) ? now : prev));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Keep the open coin's detail live: while its view stays open, refetch its
  // full series every DETAIL_LIVE_MS in the background (real data only — demo
  // never changes). ChartPanels updates via setData rather than remounting,
  // so this doesn't reset the user's pan/zoom or interrupt the crosshair.
  useEffect(() => {
    if (!detail || scan?.source !== 'okx') return;
    const symbol = detail.coin.symbol;
    const id = setInterval(() => {
      fetchFullCoin(symbol, 'okx')
        .then((fresh) => {
          if (wantDetail.current !== symbol) return; // navigated away meanwhile
          setDetail((prev) => (prev && prev.coin.symbol === symbol ? { ...prev, coin: fresh, at: Date.now() } : prev));
        })
        .catch(() => {
          // transient failure — keep showing the last good data, try again next tick
        });
    }, DETAIL_LIVE_MS);
    return () => clearInterval(id);
    // re-arms only when the open coin or data source changes, not on every poll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.coin.symbol, scan?.source]);

  const refresh = () => {
    setNonce((n) => n + 1);
    setScanAt(Date.now());
  };

  const markViewed = (symbol: string) => {
    const next = [symbol, ...recentRef.current.filter((s) => s !== symbol)].slice(0, RECENT_MAX);
    recentRef.current = next;
    void saveRecentViewed(next);
  };

  const togglePin = (symbol: string) => {
    const isPinned = pinnedRef.current.includes(symbol);
    const next = isPinned
      ? pinnedRef.current.filter((s) => s !== symbol)
      : [...pinnedRef.current, symbol];
    pinnedRef.current = next;
    setPinned(new Set(next));
    void savePinned(next);
  };

  // Open a coin's detail: cached full shows instantly, then a fresh fetch
  // replaces it in the background (2-min cooldown); no cache -> fetch overlay.
  const openCoin = (symbol: string) => {
    const origin = tab;
    const source = scan?.source ?? 'okx';
    markViewed(symbol);
    wantDetail.current = symbol;
    setFetchErr(undefined);

    void (async () => {
      const cached = source === 'okx' ? await getCachedFull(symbol) : null;
      if (wantDetail.current !== symbol) return;
      if (cached) {
        setDetail({ coin: cached.coin, at: cached.at, origin });
        if (Date.now() - cached.at < COIN_REFRESH_COOLDOWN_MS) return;
      } else if (source === 'okx') {
        setFetching(symbol);
      }
      const now = Date.now();
      if (source === 'okx' && now - (lastCoinFetch.current[symbol] ?? 0) < COIN_REFRESH_COOLDOWN_MS && cached) {
        return;
      }
      lastCoinFetch.current[symbol] = now;
      try {
        const fresh = await fetchFullCoin(symbol, source);
        if (wantDetail.current === symbol) {
          setDetail({ coin: fresh, at: Date.now(), origin });
        }
      } catch (e) {
        if (!cached && wantDetail.current === symbol) {
          setFetchErr(`拉取 ${symbol} 失敗：${e instanceof Error ? e.message : String(e)}`);
          wantDetail.current = null;
        }
      } finally {
        setFetching((f) => (f === symbol ? null : f));
      }
    })();
  };

  openCoinRef.current = openCoin;

  const closeDetail = () => {
    wantDetail.current = null;
    setDetail(null);
    setFetching(null);
  };

  const switchTab = (t: AppTab) => {
    setTab(t);
    closeDetail();
    setFetchErr(undefined);
  };

  if (!scan) {
    return (
      <div className="loading-screen">
        <div className="loading-brand">
          <BrandMark size={44} />
          <div className="brand-name">妖幣獵手</div>
        </div>
        <div className="spinner" />
        <div className="muted">
          {progress ? `正在掃描 ${progress.done}/${progress.total}…` : '正在載入市場資料…'}
        </div>
      </div>
    );
  }

  const nextInMs = SCAN_MS - (Date.now() % SCAN_MS);

  if (detail) {
    return (
      <CoinDetail
        key={detail.coin.symbol}
        coin={detail.coin}
        scannedAt={detail.at}
        source={scan.source}
        tf={tf}
        onTf={setTf}
        onBack={closeDetail}
        backLabel={detail.origin === 'search' ? '← 返回搜尋' : '← 返回掃描列表'}
        times={sigTimes[detail.coin.symbol]}
        pinned={pinned.has(detail.coin.symbol)}
        onTogglePin={() => togglePin(detail.coin.symbol)}
      />
    );
  }

  if (fetching && !detail) {
    return (
      <div className="loading-screen">
        <div className="loading-brand">
          <BrandMark size={44} />
          <div className="brand-name">妖幣獵手</div>
        </div>
        <div className="spinner" />
        <div className="muted">正在拉取 {fetching} 完整資料…</div>
      </div>
    );
  }

  if (tab === 'search') {
    return (
      <SearchView
        source={scan.source}
        scanCoins={scan.coins}
        tab={tab}
        onTab={switchTab}
        query={query}
        onQuery={setQuery}
        onPickScan={openCoin}
        onPickLive={(hit: SearchHit) => openCoin(hit.base)}
        fetching={fetching}
        fetchErr={fetchErr}
        pinned={pinned}
        onTogglePin={togglePin}
      />
    );
  }

  return (
    <ScreenerList
      scan={scan}
      nextInMs={nextInMs}
      loading={loading}
      loadErr={loadErr}
      progress={progress}
      fbOnly={fbOnly}
      onFbToggle={() => setFbOnly((v) => !v)}
      sigTimes={sigTimes}
      pinned={pinned}
      onTogglePin={togglePin}
      tab={tab}
      onTab={switchTab}
      onSelect={openCoin}
      onRefresh={refresh}
    />
  );
}
