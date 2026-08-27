import type { ReactNode } from "react";
import { PageTransition } from "@/components/ui/PageTransition";

// A template, not a layout: Next remounts this on every navigation, which is
// what makes the entrance run more than once. MemberNav stays in layout.tsx so
// the chrome doesn't re-animate underneath each page.
export default function MemberTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
