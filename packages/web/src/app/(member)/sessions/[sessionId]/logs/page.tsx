import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, itemTypeStore } from "@/lib/db";
import { EntryList } from "@/components/EntryList";

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
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <Link href={`/sessions/${sessionId}`} className="text-xs text-gray-500 hover:underline">
        ← Back to {cycle.name}
      </Link>
      <h1 className="text-lg font-semibold">Your logs</h1>
      <EntryList sessionId={sessionId} me={me} itemTypes={itemTypes} readOnly={!isParticipant} />
    </div>
  );
}
