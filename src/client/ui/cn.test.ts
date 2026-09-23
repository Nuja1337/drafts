import { describe, expect, it } from "vitest";
import { cn, conflictGroup } from "./cn";

describe("cn", () => {
  it("joins truthy parts", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
    expect(cn()).toBe("");
  });

  it("lets later classes override earlier ones of the same group", () => {
    expect(cn("w-full rounded-lg h-10 pr-8", "h-9 w-auto min-w-0")).toBe("rounded-lg pr-8 h-9 w-auto min-w-0");
    expect(cn("h-8 px-3 text-sm", "text-muted", "h-7 px-2 text-xs")).toBe("text-muted h-7 px-2 text-xs");
    expect(cn("px-1.5 py-0.5 text-xs", "px-1 py-0 text-[9px]")).toBe("px-1 py-0 text-[9px]");
    expect(cn("text-muted hover:text-text", "hover:text-bad")).toBe("text-muted hover:text-bad");
    expect(cn("bg-panel-2", "bg-accent/15")).toBe("bg-accent/15");
  });

  it("keeps classes that only look alike", () => {
    // size vs color, different variants, different sides of padding
    expect(cn("text-sm text-muted", "text-accent")).toBe("text-sm text-accent");
    expect(cn("h-[78dvh] lg:h-auto")).toBe("h-[78dvh] lg:h-auto");
    expect(cn("p-3 px-2")).toBe("p-3 px-2");
    expect(cn("font-display font-bold")).toBe("font-display font-bold");
    expect(cn("hidden lg:flex", "flex-col")).toBe("hidden lg:flex flex-col");
  });

  it("groups by variant and ignores unknown utilities", () => {
    expect(conflictGroup("lg:hover:h-9")).toBe("lg:hover:h");
    expect(conflictGroup("data-[state=open]:w-full")).toBe("data-[state=open]:w");
    expect(conflictGroup("grid-cols-[minmax(0,1fr)_20rem]")).toBeNull();
    expect(conflictGroup("text-center")).toBeNull();
  });
});
