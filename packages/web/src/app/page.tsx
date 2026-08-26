import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, currentCycleStore, cycleStore, itemTypeStore } from "@/lib/db";
import { splitSessionListItems } from "@/lib/memberSessions";
import { MemberNav } from "@/components/MemberNav";
import { Splash } from "./Splash";
import { SessionChooser } from "./SessionChooser";

// Deliberately outside the (member) route group so this stays reachable
// signed out (see Splash). `getCurrentUserRole`, not the bare `auth()` the
// brief's snippet showed: this is the most likely post-sign-in landing page,
// and getCurrentUserRole carries the joinPendingCohort side effect a
// freshly-invited member needs before listCyclesForParticipant can find
// their cohort — using bare auth() here would show them the empty-state
// copy on their very first visit, which is exactly what this milestone
// exists to fix.
//
// Sitting outside (member) also means this page renders MemberNav itself —
// the layout that mounts it for every other member screen never runs here.
export default async function Home() {
  const current = await getCurrentUserRole();
  if (!current) {
    return <Splash />;
  }

  const currentSession = await currentCycleStore.getCurrentCycle(current.clerkUserId);
  if (currentSession) {
    redirect(`/sessions/${currentSession.id}`);
  }

  // No valid pointer — stale, cleared, or never set. Not an error, never a toast.
  //
  // The groups are read even though the chooser only shows them when it has no
  // sessions at all: participation is a per-session list, not a per-group one,
  // so "in a group, in none of its sessions" is a reachable state (an admin
  // creates the session before the invitee's first sign-in and the picker
  // cannot offer someone who isn't a member yet). Naming the group turns a
  // dead end into something the member can act on.
  const [cycles, catalog, groups] = await Promise.all([
    cycleStore.listCyclesForParticipant(current.clerkUserId),
    itemTypeStore.listItemTypes(),
    cohortStore.listCohortsForUser(current.clerkUserId),
  ]);
  const emojiByKey = new Map(catalog.map((t) => [t.key, t.emoji]));
  return (
    <>
      <MemberNav currentRole={current.role} />
      <SessionChooser
        {...splitSessionListItems(cycles, emojiByKey)}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
      />
    </>
  );
}
