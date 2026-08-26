import type { Role } from "core";
import { NavBar, NavLink } from "./ui/NavBar";

export interface MemberNavProps {
  /**
   * The signed-in user's platform role, or `undefined` for a plain member.
   * Read with `userRoleStore.getRole` at the call sites, deliberately not with
   * `getCurrentUserRole`: that makes a Clerk round trip and carries the
   * invite-consuming write side effects (`joinPendingCohort`,
   * `applyPendingInviteName`), neither of which should run again on every
   * member navigation just to decide whether to draw one link.
   */
  currentRole?: Role | undefined;
}

/**
 * The member side's persistent chrome, mirroring AdminNav. Mounted in two
 * places, not one: `(member)/layout.tsx` covers /sessions, /groups and
 * /account, but `/` sits outside that route group on purpose (it has to stay
 * reachable signed out, for the splash), so `app/page.tsx` renders this itself
 * for its signed-in branches.
 *
 * Everything here used to be a per-screen `ButtonLink` bolted onto whichever
 * page a member happened to be able to reach — see the comments removed from
 * SessionChooser and /sessions, which each described themselves as the only
 * route to /account in existence.
 */
export function MemberNav({ currentRole }: MemberNavProps) {
  const isAdmin = currentRole === "owner" || currentRole === "admin";
  return (
    <NavBar brand="Mango" width="narrow">
      <NavLink href="/">Home</NavLink>
      <NavLink href="/sessions">Sessions</NavLink>
      <NavLink href="/groups">Groups</NavLink>
      {/* Hidden from plain members as a convenience, not as authorization —
          /admin's own layout still gates every request on the same role. */}
      {isAdmin && <NavLink href="/admin">Admin</NavLink>}
      <NavLink href="/account" className="ml-auto">
        You
      </NavLink>
    </NavBar>
  );
}
