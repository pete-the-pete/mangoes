import { getCurrentUserRole } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/adminUsers";
import { AdminUserTable, type AdminUserView } from "./AdminUserTable";

// Fixed locale and timezone on purpose. `toLocaleDateString()` inside the client
// component would format with the server's locale during SSR and the browser's
// on hydration — a guaranteed mismatch. Formatting here, on the server, means
// the client only ever receives a finished string.
const JOINED_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function AdminPage() {
  const current = await getCurrentUserRole();
  // Unreachable: admin/layout.tsx redirects to /sign-in when this is null. Kept
  // as a real branch rather than a non-null assertion so the narrowing is honest.
  if (!current) {
    return null;
  }

  // Read directly rather than fetching GET /admin/api/users. That route has no
  // caller after this page exists — it stays for a future client-side refresh
  // (and is already covered by its own tests), but a server component has no
  // reason to make an HTTP round-trip to itself.
  const users = await listUsersForAdmin();
  const rows: AdminUserView[] = users.map((u) => ({
    ...u,
    joined: JOINED_FMT.format(new Date(u.createdAt)),
  }));

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Users</h1>
      <AdminUserTable
        initialUsers={rows}
        canManage={current.role === "owner"}
        currentUserId={current.clerkUserId}
      />
    </div>
  );
}
