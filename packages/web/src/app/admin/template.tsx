import type { ReactNode } from "react";
import { PageTransition } from "@/components/ui/PageTransition";

// See the note in (member)/template.tsx — template, not layout, so this runs on
// each navigation rather than once per session.
export default function AdminTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
