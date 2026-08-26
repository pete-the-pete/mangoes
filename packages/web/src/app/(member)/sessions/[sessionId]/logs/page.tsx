import { notFound, redirect } from "next/navigation";
import { canManageCohort } from "@/lib/cohortAuth";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, itemTypeStore } from "@/lib/db";
import { EntryList } from "@/components/EntryList";
import { SessionTabs } from "@/components/SessionTabs";
import { PageShell } from "@/components/ui/PageShell";
import { Label } from "@/components/ui/Label";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionLogsPage({ params }: PageProps) {
  const { sessionId } = await params;

  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    if (guard.status === 401) {
      redirect("/sign-in");
    }
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

  const [catalog, canManage] = await Promise.all([
    itemTypeStore.listItemTypes({ enabledOnly: false }),
    canManageCohort(cycle.cohortId, me, guard.platformRole),
  ]);
  const itemTypes = cycle.itemTypeKeys
    .map((key) => catalog.find((t) => t.key === key))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }));

  // Same non-participant case as the session screen (requireCycleParticipant's
  // escape hatches — the platform owner, or an admin of this session's group):
  // nothing here would be this viewer's own entry, so the delete action has no
  // legitimate target.
  const isParticipant = cycle.participantIds.includes(me);

  return (
    <PageShell className="gap-4">
      {/* The same tab bar the session screen carries, so the admin tab (and
          the way back) is reachable from here too rather than only from Log. */}
      <SessionTabs
        sessionId={sessionId}
        groupId={cycle.cohortId}
        active="logs"
        adminHref={
          canManage ? `/admin/groups/${cycle.cohortId}/sessions/${sessionId}` : undefined
        }
      />
      <h1 className="font-display text-42">Your logs</h1>
      <EntryList sessionId={sessionId} me={me} itemTypes={itemTypes} readOnly={!isParticipant} />
      {!isParticipant && (
        <Label size={11} as="p" className="text-rust">
          You&rsquo;re not a participant in this session, so there is nothing of yours here.
        </Label>
      )}
    </PageShell>
  );
}
