// Request schemas for the Teams API (zod, strict: unknown fields are rejected). Pure — no Workers APIs, so unit-testable in node.
import { z } from "zod";
import { PLAYSTYLES, TRAITS, roleIds } from "../../shared/games";
import { ARCHETYPES, GAME_IDS, type GameId } from "../../shared/types";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_PLAYERS = 12;

export const LIMITS = {
  teamName: 40,
  tag: 8,
  notes: 4000,
  playerName: 32,
  note: 200,
  pool: 80,
  avoid: 50,
  overrides: 300,
} as const;

/** Ids issued by randomId() (plus some slack); anything else can't exist, so it's a 404 without a DB hit. */
export const ID_RE = /^[a-z0-9]{4,32}$/;
const CHAMPION_ID_RE = /^[A-Za-z0-9_]{1,40}$/;

// Control characters are never valid; single-line names additionally reject line breaks, every invisible "format"
// character (\p{Cf}: zero-width spaces/joiners, soft hyphen, word joiner, BOM, bidi controls) and blank-looking fillers
// (combining grapheme joiner, Hangul fillers, braille blank) \u2014 classic ways to pose as or garble another player's name.
const CONTROL_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const INVISIBLE_FILLERS = "\u034F\u115F\u1160\u3164\uFFA0\u2800";
const CONTROL_SINGLELINE = new RegExp(`[\\u0000-\\u001F\\u007F\\p{Cf}${INVISIBLE_FILLERS}]`, "u");

const singleLine = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min, min > 0 ? "Required." : undefined)
    .max(max, `Must be ${max} characters or fewer.`)
    .refine((v) => !CONTROL_SINGLELINE.test(v), "Contains invalid characters.");

const multiLine = (max: number) =>
  z
    .string()
    .max(max, `Must be ${max} characters or fewer.`)
    .refine((v) => !CONTROL_MULTILINE.test(v), "Contains invalid characters.")
    .transform((v) => v.trimEnd());

/** Optional short note: trimmed, empty → omitted. */
const optionalNote = multiLine(LIMITS.note)
  .transform((v) => v.trim() || undefined)
  .optional();

/** Length is checked before items are parsed so a huge array can't burn CPU on per-item validation. */
const boundedArray = <T extends z.ZodType>(item: T, max: number, what: string) =>
  z
    .array(z.unknown())
    .max(max, `At most ${max} ${what}.`)
    .pipe(z.array(item));

const uniqueBy =
  <T>(key: (v: T) => string, what: string) =>
  (arr: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i++) {
      const k = key(arr[i]);
      if (seen.has(k)) {
        ctx.addIssue({ code: "custom", message: `Duplicate ${what} "${k}".`, path: [i] });
        return;
      }
      seen.add(k);
    }
  };

const championId = z.string().regex(CHAMPION_ID_RE, "Invalid champion id.");
const archetypes = boundedArray(z.enum(ARCHETYPES), ARCHETYPES.length, "archetypes").superRefine(
  uniqueBy((a) => a, "archetype"),
);
const playstyleIds = PLAYSTYLES.map((p) => p.id) as [string, ...string[]];
const traitIds = TRAITS.map((t) => t.id) as [string, ...string[]];
const playstyles = boundedArray(z.enum(playstyleIds), playstyleIds.length, "playstyles").superRefine(
  uniqueBy((s) => s, "playstyle"),
);
const traits = boundedArray(z.enum(traitIds), traitIds.length, "traits").superRefine(uniqueBy((s) => s, "trait"));

// ---- Teams ----------------------------------------------------------------

export const teamName = singleLine(LIMITS.teamName, 1);
export const playerName = singleLine(LIMITS.playerName, 1);

// ---- Player name identity -------------------------------------------------

/** Cyrillic and Greek letters that render like Latin ones (mapped before lowercasing, so both cases are listed). */
const LOOKALIKES: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", І: "I", Ј: "J", Ѕ: "S",
  а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ԛ: "q", ԝ: "w",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Χ: "X", Υ: "Y",
  ο: "o",
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "gu");
const IGNORED_IN_NAMES = new RegExp(`[\\p{Cf}\\p{Mn}\\s${INVISIBLE_FILLERS}]`, "gu");

/**
 * Identity of a player name for the per-team uniqueness check: compatibility-normalised (width), with invisible
 * characters, combining marks and spaces removed and common Cyrillic/Greek look-alikes mapped to Latin, lowercased —
 * so "Alice", "ＡＬＩＣＥ", "Al ice" and Cyrillic "Аlice" all collide. Only used for comparison; names are stored as typed.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(IGNORED_IN_NAMES, "")
    .replace(LOOKALIKE_RE, (ch) => LOOKALIKES[ch] ?? ch)
    .toLowerCase();
}

/** Names that would read as a system actor in the roster or audit log. */
const RESERVED_NAME_KEYS = new Set(["Owner", "Viewer", "System", "Former player"].map(nameKey));
export const isReservedName = (name: string): boolean => RESERVED_NAME_KEYS.has(nameKey(name));

export const createTeamSchema = z.strictObject({
  name: teamName,
  game: z.enum(GAME_IDS as [GameId, ...GameId[]]),
  kind: z.enum(["team", "scout"]).optional(),
  tag: singleLine(LIMITS.tag).optional(),
});

const overrideSchema = z
  .strictObject({
    a: championId,
    b: championId,
    adv: z.number().min(-1).max(1),
    note: optionalNote,
  })
  .refine((o) => o.a !== o.b, "An override needs two different champions.");

/** Also used to re-validate "team" audit snapshots before a revert. */
export const updateTeamSchema = z.strictObject({
  name: teamName.optional(),
  tag: singleLine(LIMITS.tag).optional(),
  notes: multiLine(LIMITS.notes).optional(),
  preferredArchetypes: archetypes.optional(),
  avoidArchetypes: archetypes.optional(),
  overrides: boundedArray(overrideSchema, LIMITS.overrides, "overrides")
    .superRefine(uniqueBy((o) => `${o.a}>${o.b}`, "override"))
    .optional(),
  locked: z.boolean().optional(),
});
export type TeamPatch = z.output<typeof updateTeamSchema>;

export const addPlayerSchema = z.strictObject({ name: playerName });

export const rotateKeySchema = z.strictObject({ which: z.enum(["invite", "view", "owner"]) });

export const joinSchema = z
  .strictObject({
    playerId: z.string().regex(ID_RE, "Invalid player id.").optional(),
    name: playerName.optional(),
  })
  .refine((j) => j.playerId !== undefined || j.name !== undefined, "Pick an open slot or enter a name.");

// ---- Players (roles depend on the team's game) ---------------------------

function buildPlayerSchema(game: GameId) {
  const role = z.enum(roleIds(game) as [string, ...string[]]);
  const roleList = boundedArray(role, 5, "roles").superRefine(uniqueBy((r) => r, "role"));
  return z.strictObject({
    name: playerName.optional(),
    roles: boundedArray(z.strictObject({ role, pref: z.enum(["main", "secondary", "fill"]) }), 5, "roles")
      .superRefine(uniqueBy((r) => r.role, "role"))
      .optional(),
    pool: boundedArray(
      z.strictObject({
        championId,
        comfort: z.literal([1, 2, 3, 4, 5]),
        roles: roleList.optional(),
        note: optionalNote,
      }),
      LIMITS.pool,
      "pool entries",
    )
      .superRefine(uniqueBy((p) => p.championId, "champion"))
      .optional(),
    playstyles: playstyles.optional(),
    strengths: traits.optional(),
    weaknesses: traits.optional(),
    avoid: boundedArray(
      z.strictObject({ championId, severity: z.literal([1, 2, 3]), note: optionalNote }),
      LIMITS.avoid,
      "avoid entries",
    )
      .superRefine(uniqueBy((a) => a.championId, "champion"))
      .optional(),
    notes: multiLine(LIMITS.notes).optional(),
  });
}

const playerSchemas = { lol: buildPlayerSchema("lol"), dota2: buildPlayerSchema("dota2") } satisfies Record<GameId, unknown>;
export const playerSchema = (game: GameId) => playerSchemas[game];
export type PlayerPatch = z.output<ReturnType<typeof buildPlayerSchema>>;

// ---- Audit query ----------------------------------------------------------

export const auditQuerySchema = z.strictObject({
  before: z
    .string()
    .max(40)
    .refine((v) => !Number.isNaN(Date.parse(v)), "Must be an ISO timestamp.")
    .transform((v) => new Date(v).toISOString())
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

// ---- Error formatting ------------------------------------------------------

/** First zod issue as a readable "path: message" (used for 422 responses). */
export function formatIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Invalid request.";
  const path = issue.path.map(String).join(".");
  const message = issue.code === "invalid_type" && /received undefined$/.test(issue.message) ? "Required." : issue.message;
  return path ? `${path}: ${message}` : message;
}
