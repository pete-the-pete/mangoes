import Link from "next/link";
import type { Role } from "core";
import { Label } from "@/components/ui/Label";
import { cn } from "@/components/ui/cn";

// Owner-only links are hidden here AND 403'd server-side in their own pages.
// Hiding alone is not authorization.
export function AdminNav({ currentRole }: { currentRole: Role }) {
  return (
    <nav className="bg-ink border-ink border-b-4 border-solid">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-5 py-3">
        <Label size={9} className="text-mango-yellow mr-1 hidden sm:inline">
          Admin
        </Label>
        <NavLink href="/admin">Users</NavLink>
        <NavLink href="/admin/groups">Groups</NavLink>
        {currentRole === "owner" && <NavLink href="/admin/item-types">Item types</NavLink>}
        {/* Not an admin screen — it edits the signed-in admin's own name. It
            sits here because this nav is the only persistent chrome an admin
            ever sees. */}
        <NavLink href="/account" className="ml-auto">
          Account
        </NavLink>
      </div>
    </nav>
  );
}

/**
 * Screen 1's tab-bar treatment. Deliberately not marking an active tab: doing
 * that needs usePathname, which would make the whole nav — and every admin
 * page's shell — a client component for a purely decorative cue.
 */
function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "font-display text-cream rounded-99 min-h-11 inline-flex items-center px-3.5 text-17 opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-mango-yellow",
        className,
      )}
    >
      {children}
    </Link>
  );
}
