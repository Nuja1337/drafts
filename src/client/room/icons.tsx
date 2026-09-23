// Small inline SVG icon set for the draft room (no icon dependency).
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Icon({ title, children, className, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className ?? "size-4"}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const IconBack = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
);
export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);
export const IconShare = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);
export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </Icon>
);
export const IconPause = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </Icon>
);
export const IconPlay = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 5l12 7-12 7V5z" />
  </Icon>
);
export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </Icon>
);
export const IconReset = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
);
export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Icon>
);
export const IconX = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Icon>
);
export const IconCrown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7l4.5 4L12 5l4.5 6L21 7l-2 11H5L3 7z" />
  </Icon>
);
export const IconWarn = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Icon>
);
export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconChevron = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const IconBan = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </Icon>
);
export const IconSpark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
  </Icon>
);
export const IconSliders = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Icon>
);
