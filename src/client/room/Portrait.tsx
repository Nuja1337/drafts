// Champion/hero portrait sized by class (responsive), with image fallback and state overlays.
import { useState } from "react";
import type { Champion } from "../../shared/types";
import { cn } from "../ui";
import { IconLock } from "./icons";

export function Portrait({
  champ,
  fallbackId,
  className,
  dim,
  banned,
  locked,
  rounded = "rounded-md",
}: {
  champ: Pick<Champion, "name" | "image"> | undefined | null;
  /** Shown (abbreviated) when the champion is unknown to the loaded data. */
  fallbackId?: string | null;
  /** Size classes, e.g. "size-12 xl:size-16". */
  className?: string;
  dim?: boolean;
  banned?: boolean;
  locked?: boolean;
  rounded?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = champ?.name ?? fallbackId ?? "";
  const showImg = !!champ?.image && failedSrc !== champ.image;
  return (
    <span className={cn("relative inline-block shrink-0 overflow-hidden bg-panel-3", rounded, className ?? "size-10")}>
      {showImg ? (
        <img
          src={champ!.image}
          alt={label}
          loading="lazy"
          draggable={false}
          onError={() => setFailedSrc(champ!.image)}
          className={cn("size-full object-cover", (dim || banned || locked) && "grayscale opacity-40")}
        />
      ) : label ? (
        <span className="flex size-full items-center justify-center text-[10px] font-semibold uppercase text-muted">{label.slice(0, 3)}</span>
      ) : null}
      {banned && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="h-[2px] w-[140%] rotate-45 bg-bad/90" />
        </span>
      )}
      {locked && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-text" aria-hidden>
          <IconLock className="size-1/2 max-h-6 max-w-6 drop-shadow" />
        </span>
      )}
    </span>
  );
}
