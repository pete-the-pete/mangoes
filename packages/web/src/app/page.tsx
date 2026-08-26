import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { currentCycleStore, cycleStore, itemTypeStore } from "@/lib/db";
import { splitSessionListItems } from "@/lib/memberSessions";
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
  const [cycles, catalog] = await Promise.all([
    cycleStore.listCyclesForParticipant(current.clerkUserId),
    itemTypeStore.listItemTypes(),
  ]);
  const emojiByKey = new Map(catalog.map((t) => [t.key, t.emoji]));
  return <SessionChooser {...splitSessionListItems(cycles, emojiByKey)} />;
}
