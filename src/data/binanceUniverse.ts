import { kvGet, kvSet } from './cache';

// Binance USD-M perp symbol list. The live futures REST API (fapi) is
// geo-blocked from many regions, but data.binance.vision — Binance's public
// historical-data bucket — is reachable and enumerates every UM futures
// symbol as a folder under data/futures/um/daily/klines/. We list that
// (S3-style XML, paginated via marker) and normalise symbols to base coins.
// Cached for 24h; listings change rarely.

const LIST_TTL_MS = 24 * 3600 * 1000;
const PREFIX = 'data/futures/um/daily/klines/';
const CACHE_KEY = 'bn-universe';

// Binance futures symbol -> base coin. Binance multiplies micro-priced coins
// (1000PEPE, 1000000MOG, 1MBABYDOGE); OKX lists the bare base.
export function normalizeBinanceSymbol(sym: string): string | null {
  if (!sym.endsWith('USDT')) return null; // skip USDC/BUSD-margined
  let b = sym.slice(0, -4);
  if (b.includes('_')) return null; // dated delivery contracts, e.g. BTCUSDT_240628
  if (b.startsWith('1000000')) b = b.slice(7);
  else if (b.startsWith('1M') && b.length > 3) b = b.slice(2);
  else if (b.startsWith('1000')) b = b.slice(4);
  if (b === 'LUNA2') b = 'LUNA';
  return b || null;
}

export async function getBinancePerpBases(baseUrl: string): Promise<Set<string>> {
  const cached = await kvGet<{ at: number; bases: string[] }>(CACHE_KEY);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return new Set(cached.bases);

  const bases = new Set<string>();
  let marker = '';
  for (let page = 0; page < 10; page++) {
    const url =
      `${baseUrl}/?prefix=${encodeURIComponent(PREFIX)}&delimiter=%2F` +
      (marker ? `&marker=${encodeURIComponent(marker)}` : '');
    // no-store: the browser must not serve a cached response for this URL
    // (S3/CDN cache headers otherwise make a bad response sticky). The S3
    // endpoint is occasionally flaky (connect timeouts observed) — retry with
    // backoff instead of failing the whole universe on one bad connection.
    let res: Response | null = null;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(url, { cache: 'no-store' });
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (!res) throw lastErr instanceof Error ? lastErr : new Error('binance.vision unreachable');
    if (!res.ok) throw new Error(`binance.vision list ${res.status}`);
    const xml = await res.text();
    const prefixes = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)]
      .map((m) => m[1])
      .filter((p) => p !== PREFIX && p.startsWith(PREFIX));
    for (const p of prefixes) {
      const sym = p.slice(PREFIX.length).replace(/\/$/, '');
      const b = normalizeBinanceSymbol(sym);
      if (b) bases.add(b);
    }
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    if (!truncated || prefixes.length === 0) break;
    marker = prefixes[prefixes.length - 1];
  }

  if (bases.size < 50) throw new Error(`binance universe suspiciously small (${bases.size})`);
  await kvSet(CACHE_KEY, { at: Date.now(), bases: [...bases] });
  return bases;
}
