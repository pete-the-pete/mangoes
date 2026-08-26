import type { Role } from "core";
import { NavBar, NavLink } from "@/components/ui/NavBar";

// Owner-only links are hidden here AND 403'd server-side in their own pages.
// Hiding alone is not authorization.
export function AdminNav({ currentRole }: { currentRole: Role }) {
  return (
    <NavBar brand="Admin">
      <NavLink href="/admin">Users</NavLink>
      <NavLink href="/admin/groups">Groups</NavLink>
      {currentRole === "owner" && <NavLink href="/admin/item-types">Items</NavLink>}
      {/* The way back out. An admin is a member too, and without this the only
          route from the admin area to the app they administer is the URL bar. */}
      <NavLink href="/" className="ml-auto">
        🥭 App
      </NavLink>
      {/* Not an admin screen — it edits the signed-in admin's own name. Kept
          here as well as in MemberNav so it stays one click away from the
          admin area, which never renders the member nav. */}
      <NavLink href="/account">You</NavLink>
    </NavBar>
  );
}
