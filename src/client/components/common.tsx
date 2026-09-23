// Page-level building blocks shared by the team and data pages.
import type { ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn, Spinner } from "../ui";

const LINK_VARIANTS = {
  primary: "bg-accent text-bg hover:bg-accent-strong font-semibold",
  secondary: "bg-panel-3 text-text hover:bg-line-strong border border-line-strong",
  ghost: "text-muted hover:text-text hover:bg-panel-2",
} as const;

/** A router Link styled like ui/Button. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: LinkProps & { variant?: keyof typeof LINK_VARIANTS; size?: "sm" | "md" | "lg" }) {
  return (
    <Link
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-colors select-none whitespace-nowrap",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        LINK_VARIANTS[variant],
        className,
      )}
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-widest text-faint">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-bold break-words sm:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function LoadingBlock({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-3 py-16 text-sm text-muted", className)} role="status">
      <Spinner />
      {label}
    </div>
  );
}

type ChipTone = "accent" | "good" | "bad" | "blue";
const CHIP_ON: Record<ChipTone, string> = {
  accent: "border-accent/60 bg-accent/15 text-accent",
  good: "border-good/50 bg-good/15 text-good",
  bad: "border-bad/50 bg-bad/15 text-bad",
  blue: "border-blue/50 bg-blue/15 text-blue",
};

/** Toggleable pill used for playstyles, traits and archetypes. */
export function Chip({
  active,
  onClick,
  disabled,
  title,
  tone = "accent",
  children,
  className,
}: {
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      disabled={disabled || !onClick}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? CHIP_ON[tone] : "border-line-strong bg-panel-2 text-muted",
        onClick && !disabled && !active && "hover:border-muted hover:text-text",
        disabled && "cursor-not-allowed opacity-40",
        !onClick && "cursor-default",
        className,
      )}
    >
      {active && <span aria-hidden>✓</span>}
      {children}
    </button>
  );
}

/** Static pill (read-only display of tags). */
export function Pill({ tone, children, title }: { tone?: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tone ? CHIP_ON[tone] : "border-line-strong bg-panel-2 text-muted")}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children, hint, actions }: { children: ReactNode; hint?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-display text-lg font-semibold">{children}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Coloured banner for page-level notices (read-only mode, locked team, …). */
export function Banner({ tone = "neutral", children, action }: { tone?: "neutral" | "warn" | "bad" | "good" | "accent"; children: ReactNode; action?: ReactNode }) {
  const style = {
    neutral: "border-line-strong bg-panel-2 text-muted",
    warn: "border-warn/40 bg-warn/10 text-warn",
    bad: "border-bad/40 bg-bad/10 text-bad",
    good: "border-good/40 bg-good/10 text-good",
    accent: "border-accent/40 bg-accent/10 text-accent",
  }[tone];
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", style)}>
      <div className="min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
