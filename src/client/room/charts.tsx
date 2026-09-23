// Small SVG charts for the suggestions sidebar: win gauge, attribute radar, power curve, damage split, score bars.
// Side identity uses the theme's blue/red; text always uses text tokens. Marks carry <title> tooltips.
import { ATTRIBUTES } from "../../shared/games";
import type { Attributes, PowerCurve, Side } from "../../shared/types";
import { cn } from "../ui";

const SIDE_VAR: Record<Side, string> = { blue: "var(--color-blue)", red: "var(--color-red)" };
/** Validated against the panel surface (dark): distinct under CVD, inside the lightness band. */
export const DAMAGE_COLORS = { physical: "#c9782f", magic: "#7f68e8" } as const;

const ATTR_SHORT: Record<string, string> = {
  engage: "ENG",
  disengage: "DIS",
  peel: "PEEL",
  poke: "POKE",
  burst: "BRST",
  dps: "DPS",
  frontline: "TANK",
  cc: "CC",
  mobility: "MOB",
  waveclear: "WAVE",
  splitpush: "SPLT",
  pick: "PICK",
  sustain: "SUST",
  siege: "SIEG",
};

export function WinGauge({ value, side, label }: { value: number; side: Side; label: string }) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
  // Semicircle from 180° to 0°.
  const r = 34;
  const cx = 42;
  const cy = 40;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const pct = Math.round(v * 100);
  return (
    <div className="flex items-center gap-2" title={`${label}: ${pct}% — heuristic draft-advantage estimate, not a prediction`}>
      <svg viewBox="0 0 84 46" className="h-11 w-20 shrink-0" role="img" aria-label={`${label} ${pct}%`}>
        <path d={arc(0, 1)} stroke="var(--color-panel-3)" strokeWidth={7} fill="none" strokeLinecap="round" />
        {v > 0.005 && <path d={arc(0, v)} stroke={SIDE_VAR[side]} strokeWidth={7} fill="none" strokeLinecap="round" />}
        <line x1={cx} y1={cy - r - 5} x2={cx} y2={cy - r + 9} stroke="var(--color-muted)" strokeWidth={1} />
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-text font-display" fontSize={15} fontWeight={700}>
          {pct}%
        </text>
      </svg>
      <div className="min-w-0 text-[11px] leading-tight">
        <div className="font-semibold text-text">Draft edge</div>
        <div className="truncate text-muted">{label}</div>
      </div>
    </div>
  );
}

export function Radar({ values, names }: { values: Record<Side, Attributes>; names: Record<Side, string> }) {
  const W = 300;
  const H = 262;
  const cx = W / 2;
  const cy = H / 2;
  const R = 92;
  const n = ATTRIBUTES.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, frac: number) => [cx + R * frac * Math.cos(angle(i)), cy + R * frac * Math.sin(angle(i))] as const;
  const poly = (fracs: number[]) => fracs.map((f, i) => pt(i, f).join(",")).join(" ");
  const clamp = (x: number) => Math.min(1, Math.max(0, (Number.isFinite(x) ? x : 0) / 100));
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[320px]" role="img" aria-label="Composition attribute radar, both sides">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={poly(Array(n).fill(f))} fill="none" stroke="var(--color-line)" strokeWidth={1} />
        ))}
        {ATTRIBUTES.map((a, i) => {
          const [x, y] = pt(i, 1);
          const [lx, ly] = pt(i, 1.16);
          const anchor = Math.abs(lx - cx) < 6 ? "middle" : lx > cx ? "start" : "end";
          return (
            <g key={a.id}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-line)" strokeWidth={1} />
              <text x={lx} y={ly} dy="0.35em" textAnchor={anchor} fontSize={9.5} className="fill-muted" letterSpacing={0.5}>
                <title>{`${a.label}: ${a.description}`}</title>
                {ATTR_SHORT[a.id] ?? a.label}
              </text>
            </g>
          );
        })}
        {(["blue", "red"] as const).map((side) => {
          const fr = ATTRIBUTES.map((a) => clamp(values[side][a.id]));
          return (
            <g key={side}>
              <polygon points={poly(fr)} fill={SIDE_VAR[side]} fillOpacity={0.1} stroke={SIDE_VAR[side]} strokeWidth={2} strokeLinejoin="round" />
              {fr.map((f, i) => {
                const [x, y] = pt(i, f);
                return (
                  <g key={i}>
                    <circle cx={x} cy={y} r={3.5} fill={SIDE_VAR[side]} stroke="var(--color-panel)" strokeWidth={1.5} />
                    <circle cx={x} cy={y} r={8} fill="transparent">
                      <title>{`${names[side]} — ${ATTRIBUTES[i].label}: ${Math.round(f * 100)}`}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <Legend names={names} />
    </figure>
  );
}

export function Legend({ names }: { names: Record<Side, string> }) {
  return (
    <figcaption className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted">
      {(["blue", "red"] as const).map((s) => (
        <span key={s} className="flex min-w-0 items-center gap-1.5">
          <span className={cn("h-0.5 w-4 shrink-0 rounded-full", s === "blue" ? "bg-blue" : "bg-red")} />
          <span className="max-w-32 truncate">{names[s]}</span>
        </span>
      ))}
    </figcaption>
  );
}

export function CurveChart({ curves, names }: { curves: Record<Side, PowerCurve>; names: Record<Side, string> }) {
  const W = 300;
  const H = 120;
  const padL = 26;
  const padR = 14;
  const padT = 10;
  const padB = 22;
  const keys = ["early", "mid", "late"] as const;
  const x = (i: number) => padL + (i * (W - padL - padR)) / 2;
  const y = (v: number) => padT + (1 - Math.min(3, Math.max(0, Number.isFinite(v) ? v : 0)) / 3) * (H - padT - padB);
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Power curve by game phase, both sides">
        {[0, 1, 2, 3].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={padL - 6} y={y(v)} dy="0.35em" textAnchor="end" fontSize={9} className="fill-faint">
              {v}
            </text>
          </g>
        ))}
        {keys.map((k, i) => (
          <text key={k} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} className="fill-muted capitalize">
            {k}
          </text>
        ))}
        {(["blue", "red"] as const).map((side) => (
          <g key={side}>
            <polyline
              points={keys.map((k, i) => `${x(i)},${y(curves[side][k])}`).join(" ")}
              fill="none"
              stroke={SIDE_VAR[side]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {keys.map((k, i) => (
              <g key={k}>
                <circle cx={x(i)} cy={y(curves[side][k])} r={4} fill={SIDE_VAR[side]} stroke="var(--color-panel)" strokeWidth={2} />
                <circle cx={x(i)} cy={y(curves[side][k])} r={9} fill="transparent">
                  <title>{`${names[side]} — ${k}: ${(Number.isFinite(curves[side][k]) ? curves[side][k] : 0).toFixed(1)} / 3`}</title>
                </circle>
              </g>
            ))}
          </g>
        ))}
      </svg>
      <Legend names={names} />
    </figure>
  );
}

export function DamageBar({ damage }: { damage: { physical: number; magic: number } }) {
  const total = damage.physical + damage.magic;
  const phys = total > 0 ? damage.physical / total : 0;
  const mag = total > 0 ? damage.magic / total : 0;
  if (total <= 0) return <div className="text-xs text-faint">No damage profile yet</div>;
  const p = Math.round(phys * 100);
  return (
    <div className="space-y-1">
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${p}% physical, ${100 - p}% magic damage`}>
        {phys > 0 && <span className="h-full rounded-l-full" style={{ width: `${phys * 100}%`, background: DAMAGE_COLORS.physical }} title={`Physical ${p}%`} />}
        {mag > 0 && <span className="h-full rounded-r-full" style={{ width: `${mag * 100}%`, background: DAMAGE_COLORS.magic }} title={`Magic ${100 - p}%`} />}
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: DAMAGE_COLORS.physical }} />
          Physical {p}%
        </span>
        <span className="flex items-center gap-1">
          Magic {100 - p}%
          <span className="size-2 rounded-sm" style={{ background: DAMAGE_COLORS.magic }} />
        </span>
      </div>
    </div>
  );
}

/** Horizontal 0..max bar with a label and value (text in text tokens, bar in the side color). */
export function ScoreBar({ label, value, max = 100, side, title }: { label: string; value: number; max?: number; side: Side; title?: string }) {
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-2 text-xs" title={title}>
      <span className="truncate text-muted">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-panel-3">
        <span className={cn("block h-full rounded-full", side === "blue" ? "bg-blue" : "bg-red")} style={{ width: `${frac * 100}%` }} />
      </span>
      <span className="text-right tabular-nums text-text">{Math.round(value)}</span>
    </div>
  );
}
