// Shared Worker helpers: env typing, JSON errors, bounded body reading, rate limiting, ids and key hashing.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiErrorBody } from "../../shared/api";
import { networkKey } from "./net";

export type AppEnv = { Bindings: Env };
export type AppContext = Context<AppEnv>;

export class ApiError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    public code: string,
    message: string,
  ) {
    super(status, { message });
  }
}

export const errorBody = (code: string, message: string): ApiErrorBody => ({ error: { code, message } });

export const clientIp = (c: AppContext): string =>
  c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

/** The caller's network for per-client limits: the IPv4 address, or the IPv6 /64 (see lib/net.ts). */
export const clientKey = (c: AppContext): string => networkKey(clientIp(c));

/** Throws 429 when the limiter rejects. Silently allows if the binding is unavailable (e.g. some local setups). */
export async function rateLimit(c: AppContext, limiter: "WRITE_LIMITER" | "AI_LIMITER", scope: string): Promise<void> {
  const binding = c.env[limiter] as RateLimit | undefined;
  if (!binding) return;
  try {
    const { success } = await binding.limit({ key: `${scope}:${clientKey(c)}` });
    if (!success) throw new ApiError(429, "rate_limited", "Too many requests. Slow down and try again in a minute.");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // limiter failure should not take the API down
  }
}

/**
 * Reads the request body as JSON, refusing anything over `maxBytes` without buffering it all (a chunked upload has
 * no Content-Length to check up front). `badJsonCode` is the error code of the 400 for unparseable JSON.
 */
export async function readJsonBounded(c: AppContext, maxBytes: number, badJsonCode = "bad_json"): Promise<unknown> {
  const tooLarge = () => new ApiError(413, "too_large", `Request body must be under ${Math.floor(maxBytes / 1024)} KB.`);
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > maxBytes) throw tooLarge();
  const stream = c.req.raw.body;
  if (!stream) throw new ApiError(400, "bad_request", "Expected a JSON body.");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) throw new ApiError(400, "bad_request", "Expected a JSON body.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, badJsonCode, "Request body is not valid JSON.");
  }
}

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // no l/1/0 for readable ids

/** Random readable id (default 10 chars ≈ 50 bits). */
export function randomId(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Secret key with a type prefix, e.g. own_…, ply_…, view_…, host_…, cap_… (192 bits). */
export function randomKey(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}_${b64}`;
}

/** Hex SHA-256 — keys are stored only as hashes. */
export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison for equal-length hex hashes. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const bearer = (c: AppContext): string | null => {
  const h = c.req.header("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
};

export const nowIso = () => new Date().toISOString();
