// Client network keys for per-client limits. Pure (no Workers APIs) so it's unit-testable in node.
// An IPv4 address is used as-is; an IPv6 address becomes its /64 prefix, because one subscriber usually gets a whole
// /64 and per-address limits would be trivial to rotate around.

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;
const EMBEDDED_V4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

/** "203.0.113.7" → itself; "2001:db8:1:2:aa::1" → "2001:db8:1:2::/64"; missing → "unknown". */
export function networkKey(ip: string | null | undefined): string {
  const s = (ip ?? "").trim().toLowerCase().split("%")[0];
  if (!s) return "unknown";
  if (!s.includes(":")) return s;
  const mapped = MAPPED_V4.exec(s);
  if (mapped) return mapped[1];
  const hextets = expandIPv6(s);
  return hextets ? `${hextets.slice(0, 4).join(":")}::/64` : s;
}

/** The 8 hextets of an IPv6 address without leading zeros, or null when it doesn't parse. */
function expandIPv6(addr: string): string[] | null {
  let a = addr;
  const v4 = EMBEDDED_V4.exec(a);
  if (v4) {
    const [x, y, z, w] = v4.slice(1).map(Number);
    if ([x, y, z, w].some((n) => n > 255)) return null;
    a = `${a.slice(0, v4.index)}${((x << 8) | y).toString(16)}:${((z << 8) | w).toString(16)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (all.length !== 8 || !all.every((h) => HEXTET.test(h))) return null;
  return all.map((h) => h.replace(/^0+(?=.)/, ""));
}
