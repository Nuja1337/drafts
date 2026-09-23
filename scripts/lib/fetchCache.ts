// Throttled JSON fetcher with an on-disk cache (data/cache is gitignored) so re-runs cost no API calls.
// Stale cache entries are used as a fallback when the network or the API fails.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FetcherOptions {
  /** Minimum gap between network requests (ms). */
  minGapMs: number;
  /** Ignore fresh cache entries and refetch. */
  refresh?: boolean;
  /** Request timeout (ms). */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface FetchResult<T> {
  data: T;
  /** "cache" = fresh cache hit, "network" = fetched, "stale" = network failed and an old cache entry was used. */
  from: "cache" | "network" | "stale";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CachedFetcher {
  private last = 0;
  networkCalls = 0;
  constructor(private opts: FetcherOptions) {}

  /** Fetch JSON from `url`, caching the raw body at `cacheFile` for `ttlMs`. */
  async json<T>(url: string, cacheFile: string, ttlMs: number, validate?: (x: unknown) => x is T): Promise<FetchResult<T>> {
    const cached = this.readCache<T>(cacheFile, validate);
    if (cached && !this.opts.refresh && Date.now() - cached.mtime < ttlMs) return { data: cached.data, from: "cache" };
    try {
      const text = await this.fetchText(url);
      const data = JSON.parse(text) as unknown;
      if (validate && !validate(data)) throw new Error(`unexpected response shape from ${url}`);
      mkdirSync(dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, cacheFile);
      return { data: data as T, from: "network" };
    } catch (e) {
      if (cached) {
        this.opts.log?.(`warn: ${(e as Error).message} — using cached copy of ${url}`);
        return { data: cached.data, from: "stale" };
      }
      throw e;
    }
  }

  private readCache<T>(file: string, validate?: (x: unknown) => x is T): { data: T; mtime: number } | null {
    if (!existsSync(file)) return null;
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (validate && !validate(data)) return null;
      return { data: data as T, mtime: statSync(file).mtimeMs };
    } catch {
      return null;
    }
  }

  private async fetchText(url: string): Promise<string> {
    const backoff = [4000, 15000, 40000];
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.opts.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.networkCalls++;
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30000), headers: { accept: "application/json" } });
      } catch (e) {
        if (attempt < backoff.length) {
          this.opts.log?.(`warn: ${url} failed (${(e as Error).message}); retrying in ${backoff[attempt] / 1000}s`);
          await sleep(backoff[attempt]);
          continue;
        }
        throw new Error(`network error for ${url}: ${(e as Error).message}`);
      }
      if (res.ok) return res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < backoff.length) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff[attempt];
        this.opts.log?.(`warn: ${url} → HTTP ${res.status}; retrying in ${Math.round(delay / 1000)}s`);
        await res.body?.cancel();
        await sleep(delay);
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
  }
}
