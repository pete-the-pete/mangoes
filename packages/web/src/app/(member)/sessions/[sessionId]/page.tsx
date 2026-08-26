import { notFound, redirect } from "next/navigation";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, itemTypeStore } from "@/lib/db";
import { listCycleParticipants } from "@/lib/cycleParticipants";
import { toMemberSessionJson } from "@/lib/memberSessions";
import { SessionScreen } from "./SessionScreen";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * Server component: fetches what the sync layer deliberately doesn't own
 * (the session's own record, its item types, its participants) and hands
 * them to `SessionScreen`. `useSession` only ever tracks counts/pending ops.
 */
export default async function SessionPage({ params }: PageProps) {
  const { sessionId } = await params;

  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    if (guard.status === 401) {
      redirect("/sign-in");
    }
    // Same "not authorized" shape whether the session is missing or the
    // caller was removed from it — requireCycleParticipant already collapses
    // that distinction into one 403 for the API; notFound() does the same
    // for a page, rather than a rendered "not authorized" message that
    // confirms the session exists.
    notFound();
  }
  const me = guard.clerkUserId;
  if (!me) {
    redirect("/sign-in");
  }

  const cycle = await cycleStore.getCycle(sessionId);
  if (!cycle) {
    notFound();
  }

  const [catalog, participants] = await Promise.all([
    itemTypeStore.listItemTypes({ enabledOnly: false }),
    listCycleParticipants(cycle),
  ]);

  // Item types come from the cycle's own itemTypeKeys (already in
  // cycle_item_types.position order), not the enabled catalog — a session
  // already tracking a disabled item keeps rendering it.
  const itemTypes = cycle.itemTypeKeys
    .map((key) => catalog.find((t) => t.key === key))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }));

  return (
    <SessionScreen
      session={toMemberSessionJson(cycle)}
      itemTypes={itemTypes}
      participants={participants}
      me={me}
    />
  );
}
