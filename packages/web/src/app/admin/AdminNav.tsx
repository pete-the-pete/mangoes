import Link from "next/link";
import type { Role } from "core";

// Owner-only links are hidden here AND 403'd server-side in their own pages.
// Hiding alone is not authorization.
export function AdminNav({ currentRole }: { currentRole: Role }) {
  return (
    <nav className="border-b border-gray-200">
      <div className="mx-auto flex w-full max-w-3xl gap-4 px-6 py-3 text-sm">
        <Link href="/admin" className="hover:underline">
          Users
        </Link>
        <Link href="/admin/groups" className="hover:underline">
          Groups
        </Link>
        {currentRole === "owner" && (
          <Link href="/admin/item-types" className="hover:underline">
            Item types
          </Link>
        )}
      </div>
    </nav>
  );
}
