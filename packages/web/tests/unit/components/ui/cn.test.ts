import { describe, expect, it } from "vitest";
import { cn } from "@/components/ui/cn";

/**
 * `cn` exists to teach tailwind-merge the design system's own scales. These
 * tests pin the three things it gets wrong when left unconfigured — all of
 * which fail silently in the browser rather than throwing — so the theme lists
 * in cn.ts can't drift away from @theme in globals.css unnoticed.
 */
describe("cn", () => {
  it("keeps the sticker shadow when only its color is overridden", () => {
    // The one that actually breaks a screen. `shadow-<color>` sets only
    // --tw-shadow-color; the geometry comes from shadow-sticker-*. Unconfigured,
    // tailwind-merge reads both as one group and drops the geometry, so every
    // dark surface — where the handoff inverts the shadow to cream — renders
    // with no shadow at all.
    expect(cn("shadow-sticker-md shadow-cream")).toBe("shadow-sticker-md shadow-cream");
    expect(cn("shadow-sticker-xl shadow-ink shadow-cream")).toBe("shadow-sticker-xl shadow-cream");
  });

  it("resolves conflicts within a single custom scale", () => {
    expect(cn("shadow-sticker-md shadow-sticker-xl")).toBe("shadow-sticker-xl");
    expect(cn("rounded-18 rounded-22")).toBe("rounded-22");
    expect(cn("animate-bob animate-pulse-dot")).toBe("animate-pulse-dot");
    expect(cn("text-stroke-3 text-stroke-6")).toBe("text-stroke-6");
    expect(cn("border-5 border-3")).toBe("border-3");
  });

  it("treats the palette as colors, not as arbitrary class names", () => {
    expect(cn("bg-cream bg-ink")).toBe("bg-ink");
    expect(cn("text-ink text-mango-yellow")).toBe("text-mango-yellow");
    expect(cn("border-ink border-mango-yellow")).toBe("border-mango-yellow");
  });

  it("lets a later class win, which is what callers passing overrides expect", () => {
    // The whole point of threading `className` through a primitive.
    expect(cn("rounded-18 bg-cream", "rounded-99 bg-turquoise")).toBe("rounded-99 bg-turquoise");
  });

  it("still handles clsx input shapes", () => {
    expect(cn("p-4", null, undefined, false && "hidden", ["gap-2", { "border-3": true, "border-5": false }])).toBe(
      "p-4 gap-2 border-3",
    );
  });
});

describe("cn — type scale", () => {
  it("separates font size from text color", () => {
    // Both are `text-*`. Without the theme lists, one silently evicts the other.
    expect(cn("text-12 text-ink")).toBe("text-12 text-ink");
    expect(cn("text-ink text-12")).toBe("text-ink text-12");
  });

  it("resolves size against size and color against color", () => {
    expect(cn("text-12 text-16")).toBe("text-16");
    expect(cn("text-ink text-cream")).toBe("text-cream");
  });
});
