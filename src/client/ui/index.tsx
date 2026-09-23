// Shared UI primitives. Keep these generic; feature components live in src/client/components or next to their page.
import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { Champion, Side } from "../../shared/types";
import { cn } from "./cn";

export { cn };

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "blue" | "red";
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-bg hover:bg-accent-strong font-semibold",
  secondary: "bg-panel-3 text-text hover:bg-line-strong border border-line-strong",
  ghost: "text-muted hover:text-text hover:bg-panel-2",
  danger: "bg-red-soft text-bad hover:bg-red/30 border border-red/40",
  blue: "bg-blue text-white hover:bg-blue/85 font-semibold",
  red: "bg-red text-white hover:bg-red/85 font-semibold",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-colors select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h3>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const fieldBase =
  "w-full rounded-lg border border-line bg-panel-2 px-3 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(fieldBase, "h-10", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(fieldBase, "min-h-24 py-2", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(fieldBase, "h-10 pr-8", className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

type Tone = "neutral" | "accent" | "blue" | "red" | "good" | "bad" | "warn";
const TONES: Record<Tone, string> = {
  neutral: "bg-panel-3 text-muted border-line-strong",
  accent: "bg-accent/15 text-accent border-accent/40",
  blue: "bg-blue/15 text-blue border-blue/40",
  red: "bg-red/15 text-red border-red/40",
  good: "bg-good/15 text-good border-good/40",
  bad: "bg-bad/15 text-bad border-bad/40",
  warn: "bg-warn/15 text-warn border-warn/40",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin text-current", className ?? "size-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 rounded-lg bg-panel-2 p-1", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
            value === t.id ? "bg-panel-3 text-text shadow" : "text-muted hover:text-text",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        onMouseDown={(e) => e.stopPropagation()}
        className={cn("w-full rounded-xl border border-line-strong bg-panel shadow-2xl", wide ? "max-w-4xl" : "max-w-lg")}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-text" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", disabled && "opacity-50 cursor-not-allowed")}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", checked ? "left-4.5" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Slider({ value, onChange, min = 0, max = 2, step = 0.1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: ReactNode }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      {label && <span className="w-28 shrink-0 text-muted">{label}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-[var(--color-accent)]" />
      <span className="w-8 text-right tabular-nums text-faint">{value.toFixed(1)}</span>
    </label>
  );
}

/** 1..5 rating, used for comfort; 1..3 for severity. */
export function Stars({ value, max = 5, onChange, size = "md", color = "accent" }: { value: number; max?: number; onChange?: (v: number) => void; size?: "sm" | "md"; color?: "accent" | "bad" }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={cn(
            "leading-none transition-colors",
            size === "sm" ? "text-xs" : "text-base",
            n <= value ? (color === "bad" ? "text-bad" : "text-accent") : "text-line-strong",
            onChange && "hover:scale-110 cursor-pointer",
          )}
          aria-label={`${n}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export function CopyField({ value, label }: { value: string; label?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      {label && <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>}
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={cn(fieldBase, "h-9 font-mono text-xs")} />
        <Button
          size="sm"
          className="h-9 shrink-0"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong p-8 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{msg}</div>;
}

export const sideColor = (side: Side) => (side === "blue" ? "text-blue" : "text-red");
export const sideBg = (side: Side) => (side === "blue" ? "bg-blue" : "bg-red");
export const sideBorder = (side: Side) => (side === "blue" ? "border-blue" : "border-red");

/** Champion/hero portrait with graceful fallback. */
export function ChampIcon({
  champ,
  size = 40,
  className,
  dim,
  banned,
  title,
}: {
  champ: Pick<Champion, "name" | "image"> | undefined | null;
  size?: number;
  className?: string;
  dim?: boolean;
  banned?: boolean;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!champ) return <span style={style} className={cn("inline-block shrink-0 rounded-md bg-panel-3", className)} />;
  return (
    <span style={style} title={title ?? champ.name} className={cn("relative inline-block shrink-0 overflow-hidden rounded-md bg-panel-3", className)}>
      {!failed ? (
        <img
          src={champ.image}
          alt={champ.name}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className={cn("size-full object-cover", (dim || banned) && "grayscale opacity-40")}
        />
      ) : (
        <span className="flex size-full items-center justify-center text-[10px] font-semibold text-muted">{champ.name.slice(0, 3)}</span>
      )}
      {banned && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-[2px] w-[130%] rotate-45 bg-bad/90" />
        </span>
      )}
    </span>
  );
}
