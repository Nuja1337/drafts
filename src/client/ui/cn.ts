// Class-name joiner that also resolves Tailwind conflicts: when two classes set the same thing (w-full vs w-auto,
// h-10 vs h-9, text-sm vs text-xs, hover:text-text vs hover:text-bad…) under the same variants, the later one wins, so a
// component's className prop really overrides its defaults (plain joining leaves it to CSS source order).
// Deliberately small (no tailwind-merge dependency): it knows the utility groups this app overrides.

export type ClassValue = string | false | null | undefined;

const SIZES = "xs|sm|base|lg|xl|[2-9]xl";
const COLORS = "bg|panel|panel-2|panel-3|line|line-strong|text|muted|faint|accent|accent-strong|blue|blue-soft|red|red-soft|good|bad|warn|white|black|transparent|current|inherit";

const GROUPS: [string, RegExp][] = [
  ["w", /^w-/],
  ["min-w", /^min-w-/],
  ["max-w", /^max-w-/],
  ["h", /^h-/],
  ["min-h", /^min-h-/],
  ["max-h", /^max-h-/],
  ["size", /^size-/],
  ["p", /^p-/],
  ["px", /^px-/],
  ["py", /^py-/],
  ["pt", /^pt-/],
  ["pr", /^pr-/],
  ["pb", /^pb-/],
  ["pl", /^pl-/],
  ["text-size", new RegExp(`^text-(${SIZES}|\\[[\\d.]+(px|rem|em)\\])$`)],
  ["text-color", new RegExp(`^text-(${COLORS})(/\\d+)?$`)],
  ["bg-color", new RegExp(`^bg-(${COLORS})(/\\d+)?$`)],
  ["font-weight", /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/],
  ["rounded", /^rounded(-(none|xs|sm|md|lg|xl|2xl|3xl|full))?$/],
];

const groupCache = new Map<string, string | null>();

/** "lg:hover:h-9" → "lg:hover:h"; null for classes outside the known groups. */
export function conflictGroup(cls: string): string | null {
  const cached = groupCache.get(cls);
  if (cached !== undefined) return cached;
  // Split variants at the last ":" outside brackets (arbitrary values may contain ":").
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) cut = i;
  }
  const variants = cls.slice(0, cut + 1);
  let util = cls.slice(cut + 1);
  if (util.startsWith("!")) util = util.slice(1);
  const hit = GROUPS.find(([, re]) => re.test(util));
  const group = hit ? variants + hit[0] : null;
  groupCache.set(cls, group);
  return group;
}

const mergeCache = new Map<string, string>();

export function cn(...parts: ClassValue[]): string {
  const joined = parts.filter(Boolean).join(" ");
  const cached = mergeCache.get(joined);
  if (cached !== undefined) return cached;
  const classes = joined.split(/\s+/).filter(Boolean);
  const lastOfGroup = new Map<string, number>();
  classes.forEach((c, i) => {
    const g = conflictGroup(c);
    if (g) lastOfGroup.set(g, i);
  });
  const out = classes.filter((c, i) => {
    const g = conflictGroup(c);
    return !g || lastOfGroup.get(g) === i;
  });
  const result = out.join(" ");
  if (mergeCache.size > 2000) mergeCache.clear();
  mergeCache.set(joined, result);
  return result;
}
