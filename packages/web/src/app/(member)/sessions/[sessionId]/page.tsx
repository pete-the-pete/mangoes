import { notFound, redirect } from "next/navigation";
import { canManageCohort } from "@/lib/cohortAuth";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, itemTypeStore } from "@/lib/db";
import { listCycleParticipants } from "@/lib/cycleParticipants";
import { toMemberSessionJson } from "@/lib/memberSessions";
import { SessionScreen } from "./SessionScreen";

interface PageProps {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Server component: fetches what the sync layer deliberately doesn't own
 * (the session's own record, its item types, its participants) and hands
 * them to `SessionScreen`. `useSession` only ever tracks counts/pending ops.
 */
export default async function SessionPage({ params, searchParams }: PageProps) {
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

  const [catalog, participants, canManage] = await Promise.all([
    itemTypeStore.listItemTypes({ enabledOnly: false }),
    listCycleParticipants(cycle),
    // Decides whether to offer the admin tab, nothing more — the admin page
    // it points at runs its own gate, and so does every route under it.
    canManageCohort(cycle.cohortId, me, guard.platformRole),
  ]);

  // Item types come from the cycle's own itemTypeKeys (already in
  // cycle_item_types.position order), not the enabled catalog — a session
  // already tracking a disabled item keeps rendering it.
  const itemTypes = cycle.itemTypeKeys
    .map((key) => catalog.find((t) => t.key === key))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }));

  // requireCycleParticipant lets the platform owner, and an admin of this
  // session's group, in even when they aren't participants (its escape
  // hatches, for the API). That's for looking, not logging: a tap from
  // someone not in participantIds would credit a subject with no
  // leaderboard row.
  const isParticipant = cycle.participantIds.includes(me);

  // `?fx=rocket|confetti|clash|mania|mangonificient|two-to-mango` forces one
  // celebration instead of picking at random. Read here rather than with
  // useSearchParams in the client component,
  // which would need its own Suspense boundary. An array (`?fx=a&fx=b`) is
  // ignored; pickEffect drops anything it doesn't recognise anyway.
  const fx = (await searchParams)["fx"];

  return (
    <SessionScreen
      session={toMemberSessionJson(cycle)}
      itemTypes={itemTypes}
      participants={participants}
      me={me}
      readOnly={!isParticipant}
      adminHref={
        canManage
          ? `/admin/groups/${cycle.cohortId}/sessions/${cycle.id}`
          : undefined
      }
      forcedEffect={typeof fx === "string" ? fx : undefined}
    />
  );
}
