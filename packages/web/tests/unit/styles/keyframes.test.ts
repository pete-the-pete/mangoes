import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the bug class that shipped a broken "MANGO RAIN" to production.
 *
 * Tailwind only emits a `@keyframes` block declared inside `@theme` when some
 * *used* `--animate-*` theme variable names it. A keyframe applied by writing
 * the `animation` shorthand by hand — which is the only way to give each of
 * the 34 confetti particles its own duration and delay — is invisible to that
 * analysis, so `@keyframes burst` was silently dropped from the production
 * stylesheet and every particle animated against a name that did not exist.
 *
 * Nothing failed. The build was clean, the markup was correct, the inline
 * styles were correct, and the effect rendered 34 permanently invisible
 * mangoes. It only reproduces in a production build, which is why a browser
 * check against `next dev` missed it.
 *
 * So the invariant, stated generally: any keyframe referenced by a hand-written
 * `animation:` shorthand must be declared OUTSIDE `@theme`, where plain CSS is
 * passed through unconditionally.
 *
 * These are text assertions over CSS, which is unusual for this repo. The
 * alternative is asserting on built output, which means running a full
 * production build inside the suite. This is the cheap version of a check that
 * would otherwise not exist at all.
 */

const WEB_SRC = join(__dirname, "../../../src");
const GLOBALS = join(WEB_SRC, "app/globals.css");

/** Source text of every .ts/.tsx file under src/, excluding globals.css. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * The `@theme { ... }` block, found by brace matching rather than a regex —
 * it contains nested blocks, so a non-greedy `{[^}]*}` would stop at the first
 * inner `}` and quietly pass every assertion below.
 */
function themeBlock(css: string): string {
  const start = css.indexOf("@theme {");
  if (start < 0) throw new Error("no `@theme {` block in globals.css");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("unbalanced braces in globals.css `@theme` block");
}

describe("keyframes referenced by inline `animation` shorthands", () => {
  const css = readFileSync(GLOBALS, "utf8");
  const theme = themeBlock(css);
  const outsideTheme = css.replace(theme, "");

  /**
   * Keyframe names used in a hand-written `animation:` shorthand in src/.
   *
   * The shorthand puts the name first, so the first token after `animation:`
   * is it. Two forms are excluded rather than matched: `none`, and anything
   * starting `var(` — a value indirected through a custom property is a theme
   * token by definition, which is the case Tailwind already tracks and the
   * case this file is not about.
   */
  const NOT_A_KEYFRAME = new Set(["none", "var", "inherit", "initial", "unset", "revert"]);
  const inlineNames = [
    ...new Set(
      sourceFiles(WEB_SRC)
        .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/animation:\s*[`"\x27]?([a-zA-Z][\w-]*)/g)])
        .map((m) => m[1]!)
        .filter((name) => !NOT_A_KEYFRAME.has(name)),
    ),
  ];

  it("finds the inline shorthands it is meant to be checking", () => {
    // If this ever empties out, every assertion below passes vacuously.
    expect(inlineNames).toContain("burst");
  });

  it.each(inlineNames)("declares `%s` outside @theme, so it survives the build", (name) => {
    const declaration = new RegExp(`@keyframes\\s+${name}\\s*\\{`);
    expect(
      declaration.test(outsideTheme),
      `@keyframes ${name} is applied by an inline animation shorthand, so it must be declared ` +
        `outside @theme in globals.css or Tailwind will tree-shake it out of the production CSS.`,
    ).toBe(true);
    expect(
      declaration.test(theme),
      `@keyframes ${name} is inside @theme, where nothing references it via an --animate-* ` +
        `token. It will be dropped from the production stylesheet and the animation will ` +
        `silently do nothing. Move it out; adding a token does not fix this.`,
    ).toBe(false);
  });
});
