import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { RegisterServiceWorker } from "./RegisterServiceWorker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mango Tracker",
  description: "Coming soon",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Clerk v7 requires ClerkProvider inside <body>, not wrapping <html> —
          wrapping <html> opts the whole app into dynamic rendering. */}
      <body className="min-h-full flex flex-col">
        <ClerkProvider>{children}</ClerkProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
