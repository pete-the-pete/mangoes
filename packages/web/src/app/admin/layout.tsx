import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { AdminNav } from "./AdminNav";
import { PageShell } from "@/components/ui/PageShell";
import { Label } from "@/components/ui/Label";

// Gates the /admin *pages* only. Route handlers don't run layouts, so the
// /admin/api/* endpoints added in Tasks 7-9 are guarded by requireRole() inside
// each handler, never by this.
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const current = await getCurrentUserRole();
  if (!current) {
    redirect("/sign-in");
  }
  if (current.role !== "owner" && current.role !== "admin") {
    return (
      <PageShell surface="ink-deep" className="items-center justify-center text-center">
        <span aria-hidden="true" className="text-[4.5rem] leading-none">
          🚪
        </span>
        <h1 className="font-display text-mango-yellow text-42">Not authorized</h1>
        <Label size={11} as="p" className="text-cream/70">
          Your account does not have access to the admin area.
        </Label>
      </PageShell>
    );
  }
  return (
    <>
      <AdminNav currentRole={current.role} />
      {children}
    </>
  );
}
