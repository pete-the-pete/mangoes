import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

/** @clerk/types isn't a direct dependency, so take the shape from the provider. */
type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

/**
 * Clerk renders its own component tree, so it cannot pick up the design
 * tokens in globals.css. Without this it ships its default blue-on-white
 * theme, which the splash now links straight into — the seam is the first
 * thing anyone signing in would see.
 *
 * Deliberately `variables` plus a short `elements` list rather than
 * @clerk/themes: the variables carry the palette, type and radius, and only
 * the primary button needs the sticker treatment to stop looking foreign.
 * A full element-by-element restyle would be a maintenance burden against
 * Clerk's internal class names for very little more fidelity.
 *
 * Hex literals rather than var(--color-*): Clerk parses these values to derive
 * hover and disabled shades, and cannot do that with a var() reference. The
 * font families are the exception — those it passes through untouched.
 *
 * Variable names follow this Clerk version's API (colorForeground, not
 * colorText); it renamed several of them, and the wrong name is a type error
 * rather than a silent no-op only because Appearance is typed off the
 * provider below.
 */
export const clerkAppearance: Appearance = {
  // Puts Clerk's stylesheet in the `clerk` layer, which globals.css orders
  // below Tailwind's utilities so the classes in `elements` below actually
  // take effect instead of computing to nothing.
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "#10312B", // ink — Clerk's primary surfaces and links
    colorPrimaryForeground: "#FFF1D6", // cream
    colorBackground: "#FFF1D6",
    colorForeground: "#10312B",
    colorMutedForeground: "#B8380B", // rust
    colorInput: "#FFFFFF",
    colorInputForeground: "#10312B",
    colorBorder: "#10312B",
    colorDanger: "#FF2D6F",
    colorSuccess: "#00C2B0",
    colorWarning: "#FF7A18",
    colorModalBackdrop: "rgba(16,49,43,.6)",
    borderRadius: "16px",
    fontFamily: "var(--font-space-grotesk), sans-serif",
    fontFamilyButtons: "var(--font-anton), sans-serif",
  },
  elements: {
    card: "border-4 border-solid border-ink shadow-sticker-md shadow-ink",
    formButtonPrimary:
      "font-display uppercase text-ink bg-mango-yellow border-4 border-solid border-ink shadow-sticker-sm shadow-ink hover:bg-mango-yellow",
    headerTitle: "font-display uppercase",
    footerActionLink: "text-rust",
  },
};
