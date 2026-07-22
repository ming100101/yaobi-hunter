import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type {
  Coin,
  CoinLite,
  Regime,
  ScanProgress,
  ScanResult,
  ScreenerSortDir,
  ScreenerSortKey,
  SignalTimes,
  ThemeName,
  Timeframe,
} from './types';
import { fetchBtcRegime, fetchFullCoin, getCachedFull, runMicroScan, startScan } from './data/scan';
import { toLite } from './data/binance';
import {
  kvGet,
  kvGetFresh,
  kvSet,
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
import { buildScanRecord, buildSweepMeta } from './lib/recording';
import { applyEvidencePaperDecision, createPaperState, drivePaper, evidenceApprovedPaperEdges } from './lib/paper';
import type { PaperState } from './lib/paper';
import { hydrateSignalLog } from './lib/signalLog';
import { top10Ranks } from './lib/rank';
import ScreenerList from './components/ScreenerList';
import SearchBar from './components/SearchBar';
import BrandMark from './components/BrandMark';
import NavTabs, { type AppTab } from './components/NavTabs';

// The scan list is the cold-start surface. Charts and secondary pages are
// embedded as separate chunks and parsed only when the user opens them.
const CoinDetail = lazy(() => import('./components/CoinDetail'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const StrategyView = lazy(() => import('./components/StrategyView'));
const HistoryView = lazy(() => import('./components/HistoryView'));
const PushWatchView = lazy(() => import('./components/PushWatchView'));

// 15-min recording-slot size. Scanning is now continuous (back-to-back), but
// record/paper/signal-times are still written once per 15-min slot (see the gate
// in the scan effect), so the recorded dataset stays 15-min and nothing dupes.
const SCAN_MS = 15 * 60 * 1000;
const COIN_REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
const DETAIL_LIVE_MS = 20 * 1000;
const RECENT_MAX = 20;
// Continuous scan: after a sweep finishes, chain the next one. A short breather
// on success (the sweep itself is the real spacing); a longer backoff on
// error/demo so a dead exchange can't tight-loop.
const SCAN_GAP_MS = 2 * 1000;
const SCAN_ERROR_BACKOFF_MS = 60 * 1000;
// M1 single-driver window: skip the paper drive if the other process (recorder)
// drove within this long, so app + recorder never double-drive the same slot.
const PAPER_DRIVER_TTL = 5 * 60 * 1000;
// S3 micro-scan: warm-only re-check of top candidates between full sweeps
const MICRO_MS = 75_000;
const MICRO_BACKOFF_MS = 10 * 60 * 1000; // double the cadence for this long after a 429

function TabChunkFallback({ tab, onTab }: { tab: AppTab; onTab: (tab: AppTab) => void }) {
  return (
    <div className="page scan-loading-page" aria-busy="true">
      <div className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">妖幣獵手</div>
            <div className="brand-sub">正在打開頁面</div>
          </div>
        </div>
        <NavTabs tab={tab} onTab={onTab} />
      </div>
      <div className="card scan-loading-card">
        <div className="spinner" />
        <div><strong>載入頁面中…</strong></div>
      </div>
    </div>
  );
}

function DetailChunkFallback() {
  return (
    <div className="loading-screen" aria-busy="true">
      <div className="loading-brand"><BrandMark size={44} /><div className="brand-name">妖幣獵手</div></div>
      <div className="spinner" />
      <div className="muted">正在打開圖表…</div>
    </div>
  );
}

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
  // U2 screener sort/filter (persist to settings deferred to U1 — App state
  // survives tab switches, resets on full reload).
  const [sortKey, setSortKey] = useState<ScreenerSortKey>('strength');
  const [sortDir, setSortDir] = useState<ScreenerSortDir>('desc');
  const [regimeSet, setRegimeSet] = useState<Set<Regime>>(() => new Set());
  const [minVol, setMinVol] = useState(0); // USD; 0 = all
  // click a header: → this column desc → asc → back to default (strength desc)
  const cycleSort = (key: ScreenerSortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else {
      setSortKey('strength');
      setSortDir('desc');
    }
  };
  const toggleRegime = (r: Regime) =>
    setRegimeSet((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

  // open detail view (full-series coin, fetched on demand)
  const [detail, setDetail] = useState<{ coin: Coin; at: number; origin: AppTab } | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchErr, setFetchErr] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  // search is a pop-up overlay (not a page): 搜尋 opens it over the current view
  const [searchOpen, setSearchOpen] = useState(false);

  const [, setTick] = useState(0);

  // when each coin first entered top-10 / first fired ⚡ / first fired 蓄
  const [sigTimes, setSigTimes] = useState<SignalTimes>({});
  const sigTimesRef = useRef<SignalTimes>({});
  // S3 micro-scan: ⚡ baseline threaded across cycles (reseeded each full sweep);
  // microRef mirrors fresh scan/pinned so the 75s timer isn't reset every batch.
  const curFbRef = useRef<Set<string>>(new Set());
  const microRef = useRef<{ coins: CoinLite[]; pinned: Set<string>; source: ScanResult['source'] }>({
    coins: [],
    pinned: new Set(),
    source: 'binance',
  });

  // M1 paper book (shared with the recorder via kv.json); drives on each
  // completed live sweep and renders as a compact chip in the screener topbar
  const [paper, setPaper] = useState<PaperState | null>(null);

  // F1: 🎀 y2k theme toggle — cosmetics only (theme.css token overrides).
  // Persisted under kv 'theme' so it survives reloads AND port drift (P0).
  const [theme, setTheme] = useState<ThemeName>('dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggleTheme = () =>
    setTheme((t) => {
      const next: ThemeName = t === 'y2k' ? 'dark' : 'y2k';
      void kvSet('theme', next);
      return next;
    });

  // user-pinned symbols — explicit choice, always float to the top of the list
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const pinnedRef = useRef<string[]>([]); // insertion order, for priority-fetch

  const recentRef = useRef<string[]>([]);
  const scanGen = useRef(0);
  const chainTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // schedules the next continuous sweep
  const lastSlotRef = useRef(-1); // last 15-min slot that was recorded/paper-driven
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
    kvGet<PaperState>('paper-state').then((p) => {
      if (!cancelled && p) setPaper(p);
    });
    kvGet<ThemeName>('theme').then((t) => {
      if (!cancelled && t === 'y2k') setTheme(t);
    });
    void hydrateSignalLog(); // load the persisted 24h Signal Read history


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
    // shared THE-top-10 definition (lib/rank) — same set the screener chip gates on
    const top10 = new Set(top10Ranks(coins).keys());
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

  // fire-and-forget one JSONL snapshot per completed live sweep to /record
  // (exe: server.cjs; dev: vite middleware), followed by a sweep-meta
  // completeness line. Best-effort — never blocks the UI.
  const recordSweep = (coins: CoinLite[], tsMs: number) => {
    try {
      const post = (body: string) =>
        void fetch('/record', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }).catch(() => {});
      post(JSON.stringify(buildScanRecord(coins, tsMs, 'binance')));
      // E3: tag the sweep-meta with BTC regime (15min-cached fetch, best-effort —
      // on failure the meta still posts untagged so recording never blocks on it)
      void fetchBtcRegime()
        .catch(() => null)
        .then((regime) => {
          post(JSON.stringify(buildSweepMeta(coins.length, tsMs, Date.now() - tsMs, undefined, undefined, { regime })));
        });
    } catch {
      /* ignore */
    }
  };

  // Advance the paper book once per completed live sweep. Best-effort — wrapped
  // so the sim can never throw into the sweep path (data collection outranks it).
  // `prevFb` = ⚡ symbols live as of the previous sweep, so a rising edge (off→on)
  // opens a virtual position. Reads state fresh to honour the single-driver rule
  // against a running recorder; whoever drove within the TTL owns the slot.
  const drivePaperSweep = (coins: CoinLite[], tsMs: number, prevFb: Set<string>) => {
    void (async () => {
      try {
        const stored = (await kvGetFresh<PaperState>('paper-state')) ?? createPaperState();
        const state = applyEvidencePaperDecision(stored, tsMs);
        const now = Date.now();
        if (now - state.lastDriverTs < PAPER_DRIVER_TTL && state.driver === 'recorder') {
          setPaper(state); // recorder is alive and owns this slot — just mirror it
          return;
        }
        const marks = new Map(coins.map((c) => [c.symbol, c.lastPrice] as [string, number]));
        const next = drivePaper(state, marks, evidenceApprovedPaperEdges(coins, prevFb), tsMs);
        next.lastDriverTs = now;
        next.driver = 'app';
        await kvSet('paper-state', next);
        setPaper(next);
      } catch {
        /* the paper sim must never break the sweep */
      }
    })();
  };

  // Continuous rolling scan: runs on first load and each time the previous sweep
  // finishes (chained below), plus manual refresh. The live screener (setScan)
  // updates every sweep for early signal detection; record/paper/signal-times are
  // gated to once per 15-min slot so the dataset stays 15-min and nothing dupes.
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
      if (source !== 'demo') {
        void notifyNewSignals(coins, (sym) => openCoinRef.current(sym));
        if (prog && prog.done === prog.total) {
          // once per 15-min slot only: don't re-save data we already have when
          // sweeps run back-to-back within the same slot
          const slot = Math.floor(scanAt / SCAN_MS);
          if (slot !== lastSlotRef.current) {
            lastSlotRef.current = slot;
            // capture last slot's ⚡ set BEFORE updateSignalTimes overwrites it,
            // so the paper drive can open on the rising edge (off last → on now)
            const prevFb = new Set(
              Object.keys(sigTimesRef.current).filter((s) => sigTimesRef.current[s]?.fb != null),
            );
            updateSignalTimes(coins);
            // S3: reseed the micro-scan ⚡ baseline from this completed sweep
            curFbRef.current = new Set(coins.filter((c) => c.flushBreakout).map((c) => c.symbol));
            recordSweep(coins, scanAt);
            drivePaperSweep(coins, scanAt, prevFb);
          }
        }
      }
      setScan((prev) => {
        // never let a demo fallback overwrite real (cached/previous) data
        if (source === 'demo' && prev && prev.source !== 'demo') return prev;
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
          if (prev && prev.source !== 'demo') void saveCachedScan(prev);
          return prev;
        });
      }
      // chain the next sweep: brief breather on success, backoff on error/demo
      if (chainTimer.current) clearTimeout(chainTimer.current);
      chainTimer.current = setTimeout(
        () => {
          if (scanGen.current === gen) setScanAt(Date.now());
        },
        error ? SCAN_ERROR_BACKOFF_MS : SCAN_GAP_MS,
      );
    });
    return () => {
      handle.abort();
      if (chainTimer.current) clearTimeout(chainTimer.current);
    };
  }, [scanAt, nonce]);

  // 1s heartbeat so relative ages (signal ages, 上次掃描) stay fresh between
  // sweeps. (Scan cadence is now driven by chaining, not by this tick.)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Keep the open coin's detail live: while its view stays open, refetch its
  // full series every DETAIL_LIVE_MS in the background (real data only — demo
  // never changes). ChartPanels updates via setData rather than remounting,
  // so this doesn't reset the user's pan/zoom or interrupt the crosshair.
  useEffect(() => {
    if (!detail || !scan || scan.source === 'demo') return;
    const symbol = detail.coin.symbol;
    const id = setInterval(() => {
      fetchFullCoin(symbol, 'binance')
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
    const source = scan?.source ?? 'binance';
    markViewed(symbol);
    wantDetail.current = symbol;
    setFetchErr(undefined);

    void (async () => {
      const cached = source !== 'demo' ? await getCachedFull(symbol) : null;
      if (wantDetail.current !== symbol) return;
      // A scan-cached full has NO long series (the sweep only carries the 48h
      // base), so 1h/4h would sit on the 2-day fallback — never let the
      // freshness/cooldown short-circuits keep that on screen; only a cache
      // that already carries `long` counts as complete enough to skip a fetch.
      const cachedComplete = cached != null && cached.coin.long != null;
      if (cached) {
        setDetail({ coin: cached.coin, at: cached.at, origin });
        if (cachedComplete && Date.now() - cached.at < COIN_REFRESH_COOLDOWN_MS) return;
      } else if (source !== 'demo') {
        setFetching(symbol);
      }
      const now = Date.now();
      if (source !== 'demo' && now - (lastCoinFetch.current[symbol] ?? 0) < COIN_REFRESH_COOLDOWN_MS && cachedComplete) {
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

  // S3 micro-scan: every ~75s, warm-only re-check the top candidates for a
  // mid-slot ⚡ (caught in ~75s instead of up to 14 min). Live-source + visible
  // tab only; never touches rubik (fetchLiveCoinWarm skips cold coins); does NOT
  // re-rank the list — onFire only flips the ⚡ flag + notifies + sets the age.
  microRef.current = { coins: scan?.coins ?? [], pinned, source: scan?.source ?? 'binance' };
  useEffect(() => {
    let stopped = false;
    let backoffUntil = 0;
    let timer: ReturnType<typeof setTimeout>;
    const onFire = (coin: Coin) => {
      const sym = coin.symbol;
      setScan((prev) =>
        prev
          ? { ...prev, coins: prev.coins.map((c) => (c.symbol === sym ? { ...c, flushBreakout: true } : c)) }
          : prev,
      );
      void notifyNewSignals([toLite(coin)], (s) => openCoinRef.current(s));
      if (sigTimesRef.current[sym]?.fb == null) {
        const now = Date.now();
        const next: SignalTimes = { ...sigTimesRef.current, [sym]: { ...sigTimesRef.current[sym], fb: now } };
        sigTimesRef.current = next;
        setSigTimes(next);
        void saveSignalTimes(next);
      }
    };
    const run = async () => {
      if (stopped) return;
      const { coins, pinned: pins, source } = microRef.current;
      if (source !== 'demo' && document.visibilityState === 'visible' && coins.length) {
        // pinned ∪ strength top-20 (coins is strength-sorted), cap 25, and skip
        // the open-detail coin (its 20s poll already covers it).
        const top20 = coins.slice(0, 20).map((c) => c.symbol);
        const cands = [...new Set([...pins, ...top20])]
          .filter((s) => s !== wantDetail.current)
          .slice(0, 25);
        if (cands.length) {
          try {
            const res = await runMicroScan(cands, curFbRef.current, onFire, Date.now());
            curFbRef.current = res.nextFb;
            if (res.checked)
              console.log(`[micro] checked ${res.checked} cold ${res.skippedCold} fired ${res.fired}`);
            if (res.saw429) backoffUntil = Date.now() + MICRO_BACKOFF_MS;
          } catch {
            /* micro-scan is best-effort */
          }
        }
      }
      if (!stopped) timer = setTimeout(run, Date.now() < backoffUntil ? MICRO_MS * 2 : MICRO_MS);
    };
    timer = setTimeout(run, MICRO_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const closeDetail = () => {
    wantDetail.current = null;
    setDetail(null);
    setFetching(null);
  };

  const switchTab = (t: AppTab) => {
    if (t === 'search') {
      setSearchOpen(true); // pop-up, not a page — leave the current tab as-is
      return;
    }
    setTab(t);
    closeDetail();
    setFetchErr(undefined);
  };

  if (detail) {
    return (
      <Suspense fallback={<DetailChunkFallback />}>
        <CoinDetail
          key={detail.coin.symbol}
          coin={detail.coin}
          scannedAt={detail.at}
          source={scan?.source ?? 'binance'}
          tf={tf}
          onTf={setTf}
          onBack={closeDetail}
          backLabel={
            detail.origin === 'pushes'
              ? '← 返回推送監察'
              : detail.origin === 'history'
                ? '← 返回記錄'
                : detail.origin === 'strategy'
                  ? '← 返回策略'
                  : '← 返回掃描列表'
          }
          times={sigTimes[detail.coin.symbol]}
          pinned={pinned.has(detail.coin.symbol)}
          onTogglePin={() => togglePin(detail.coin.symbol)}
          paper={paper}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
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

  const searchOverlay = searchOpen && scan ? (
    <SearchBar
      source={scan.source}
      scanCoins={scan.coins}
      query={query}
      onQuery={setQuery}
      onPick={(sym) => {
        setSearchOpen(false);
        openCoin(sym);
      }}
      onClose={() => setSearchOpen(false)}
      fetching={fetching}
      pinned={pinned}
      onTogglePin={togglePin}
    />
  ) : null;

  if (tab === 'settings') {
    return (
      <>
        <Suspense fallback={<TabChunkFallback tab={tab} onTab={switchTab} />}>
          <SettingsView tab={tab} onTab={switchTab} />
        </Suspense>
        {searchOverlay}
      </>
    );
  }

  if (tab === 'strategy') {
    return (
      <>
        <Suspense fallback={<TabChunkFallback tab={tab} onTab={switchTab} />}>
          <StrategyView tab={tab} onTab={switchTab} paper={paper} />
        </Suspense>
        {searchOverlay}
      </>
    );
  }

  if (tab === 'history') {
    return (
      <>
        <Suspense fallback={<TabChunkFallback tab={tab} onTab={switchTab} />}>
          <HistoryView tab={tab} onTab={switchTab} onSelect={openCoin} />
        </Suspense>
        {searchOverlay}
      </>
    );
  }

  if (tab === 'pushes') {
    return (
      <>
        <Suspense fallback={<TabChunkFallback tab={tab} onTab={switchTab} />}>
          <PushWatchView
            tab={tab}
            onTab={switchTab}
            coins={scan?.coins ?? []}
            source={scan?.source ?? 'binance'}
            onSelect={openCoin}
          />
        </Suspense>
        {searchOverlay}
      </>
    );
  }

  if (!scan) {
    return (
      <div className="page scan-loading-page">
        <div className="topbar">
          <div className="brand">
            <BrandMark />
            <div>
              <div className="brand-name">妖幣獵手</div>
              <div className="brand-sub">市場掃描準備中 · 推送與設定仍可使用</div>
            </div>
          </div>
          <NavTabs tab={tab} onTab={switchTab} />
        </div>
        <div className="card scan-loading-card">
          <div className="spinner" />
          <div>
            <strong>{progress ? `正在掃描 ${progress.done}/${progress.total}` : '正在載入市場資料'}</strong>
            <p className="muted">Binance繁忙或限速時，推送監察、策略、記錄同設定頁仍然可以直接打開。</p>
            {loadErr && <p className="set-err">{loadErr}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <ScreenerList
      scan={scan}
      loading={loading}
      loadErr={loadErr}
      progress={progress}
      fbOnly={fbOnly}
      onFbToggle={() => setFbOnly((v) => !v)}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={cycleSort}
      regimeSet={regimeSet}
      onRegimeToggle={toggleRegime}
      minVol={minVol}
      onMinVol={setMinVol}
      paper={scan.source !== 'demo' ? paper : null}
      sigTimes={sigTimes}
      pinned={pinned}
      onTogglePin={togglePin}
      tab={tab}
      onTab={switchTab}
      onSelect={openCoin}
      onRefresh={refresh}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
    {searchOverlay}
    </>
  );
}
