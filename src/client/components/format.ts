// Small display formatters shared by team and data pages.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 minutes ago", "yesterday", "just now". Accepts ISO strings or epoch ms. */
export function timeAgo(when: string | number, now = Date.now()): string {
  const t = typeof when === "number" ? when : Date.parse(when);
  if (!Number.isFinite(t)) return "";
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === "minute") return rtf.format(Math.round(diff / secs), unit);
  }
  return "just now";
}

/** Full local date-time for tooltips. */
export function fullDate(when: string | number): string {
  const d = new Date(when);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** 0.534 → "53.4%" */
export const pct = (v: number | undefined, digits = 1): string => (v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`);

/** 0.42 → "+0.42" */
export const signed = (v: number, digits = 2): string => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

/** Compact counts: 1234 → "1.2k", 31303 → "31k". */
export function compact(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Case/diacritic/punctuation-insensitive search key: "Kai'Sa" → "kaisa". */
export const searchKey = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
