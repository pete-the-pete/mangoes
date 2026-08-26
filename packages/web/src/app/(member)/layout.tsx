import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { userRoleStore } from "@/lib/db";
import { MemberNav } from "@/components/MemberNav";

// Gates the member *pages* only, mirroring app/admin/layout.tsx. Route handlers
// under /api/* do not run layouts and call requireCycleParticipant themselves.
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  // A direct store read rather than getCurrentUserRole(): this runs on every
  // member navigation, and getCurrentUserRole adds a Clerk round trip plus the
  // invite-consuming writes that only need to happen on the landing page. The
  // role decides one nav link; it is not the authorization for anything here.
  const role = await userRoleStore.getRole(userId);

  return (
    <>
      <MemberNav currentRole={role} />
      {children}
    </>
  );
}
