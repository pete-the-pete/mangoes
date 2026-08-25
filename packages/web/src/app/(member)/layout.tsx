import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

// Gates the member *pages* only, mirroring app/admin/layout.tsx. Route handlers
// under /api/* do not run layouts and call requireCycleParticipant themselves.
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  return <>{children}</>;
}
