import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Anton, Space_Grotesk } from "next/font/google";
import { RegisterServiceWorker } from "./RegisterServiceWorker";
import { MotionProvider } from "./MotionProvider";
import { clerkAppearance } from "./clerkAppearance";
import "./globals.css";

// The design system's two families, and only these two (docs/design/handoff.md):
// Anton for all display type — numbers, headings, button labels, names — and
// Space Grotesk for everything small. Anton ships a single weight and isn't a
// variable font, so `weight` is required here.
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mango Tracker",
  description: "Tap a mango. Break the internet.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  // Matches manifest.webmanifest's theme_color — the PWA title bar picks this
  // up, and a mismatch between the two shows as a seam on Android.
  themeColor: "#FFD400",
  // The palette is a fixed cream/ink one with no dark variant, so tell the
  // browser as much: without this it will auto-darken form controls and
  // scrollbars for dark-mode users against a page that never goes dark.
  colorScheme: "light",
  // Standalone PWA on a notched phone — lets the app paint into the safe
  // areas, which is what `env(safe-area-inset-*)` padding then reclaims.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      {/* Clerk v7 requires ClerkProvider inside <body>, not wrapping <html> —
          wrapping <html> opts the whole app into dynamic rendering. */}
      <body className="min-h-full flex flex-col">
        {/* One provider at the root. Scoping it to only the trees that animate
            was tried and measured: it saved nothing, because `/` serves both the
            signed-out Splash and the signed-in chooser from one route module,
            and `next/dynamic` on the chooser didn't drop it from the initial
            payload either. Motion costs ~40KB gzipped on every page as a result,
            landing page included — the honest price of the celebration and the
            list entrances. LazyMotion below is what keeps it to that. */}
        <ClerkProvider appearance={clerkAppearance}>
          <MotionProvider>{children}</MotionProvider>
        </ClerkProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
