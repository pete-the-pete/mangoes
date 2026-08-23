import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";

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
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="text-sm text-gray-500">
          Your account does not have access to the admin area.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
