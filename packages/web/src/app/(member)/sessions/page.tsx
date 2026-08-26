import Link from "next/link";
import { getCurrentUserRole } from "@/lib/auth";
import { cycleStore, itemTypeStore } from "@/lib/db";
import { splitSessionListItems, type SessionListItem } from "@/lib/memberSessions";
import { SessionCard } from "@/components/SessionCard";

// The browsable counterpart to the `/` chooser: same three groupings, but a
// plain list — choosing here never touches the current-session pointer, it
// just navigates. Past (closed) sessions are viewable here (a vision Must
// Have) even though they'd never appear on the one-shot chooser once a
// pointer exists.
export default async function SessionsPage() {
  const current = await getCurrentUserRole();
  if (!current) {
    // (member)/layout.tsx already redirects signed-out visitors before this
    // renders; this is just defense in depth, matching the admin pages' convention.
    return null;
  }

  const [cycles, catalog] = await Promise.all([
    cycleStore.listCyclesForParticipant(current.clerkUserId),
    itemTypeStore.listItemTypes(),
  ]);
  const emojiByKey = new Map(catalog.map((t) => [t.key, t.emoji]));
  const { live, scheduled, recent } = splitSessionListItems(cycles, emojiByKey);
  const isEmpty = live.length === 0 && scheduled.length === 0 && recent.length === 0;

  function renderGroup(label: string, items: SessionListItem[]) {
    if (items.length === 0) return null;
    return (
      <section className="flex flex-col gap-2" key={label}>
        <h2 className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</h2>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <Link key={item.id} href={`/sessions/${item.id}`}>
              <SessionCard {...item} />
            </Link>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Sessions</h1>
      {isEmpty && <p className="text-sm text-gray-500">No sessions yet — an admin will add you to one.</p>}
      {renderGroup("Live", live)}
      {renderGroup("Scheduled", scheduled)}
      {renderGroup("Recent", recent)}
    </div>
  );
}
