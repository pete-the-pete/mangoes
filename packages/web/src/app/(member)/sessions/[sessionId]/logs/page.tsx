import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, itemTypeStore } from "@/lib/db";
import { EntryList } from "@/components/EntryList";
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

  const catalog = await itemTypeStore.listItemTypes({ enabledOnly: false });
  const itemTypes = cycle.itemTypeKeys
    .map((key) => catalog.find((t) => t.key === key))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }));

  // Same non-participant case as the session screen (requireCycleParticipant's
  // platform-owner bypass): nothing here would be this viewer's own entry, so
  // the delete action has no legitimate target.
  const isParticipant = cycle.participantIds.includes(me);

  return (
    <PageShell className="gap-4">
      <Link
        href={`/sessions/${sessionId}`}
        className="font-display text-rust self-start text-15 underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        ← Back to {cycle.name}
      </Link>
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
