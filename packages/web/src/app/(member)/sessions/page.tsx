import Link from "next/link";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { splitSessionListItems } from "@/lib/memberSessions";
import { SessionCard } from "@/components/SessionCard";
import { SessionGroups } from "@/components/SessionGroups";
import { EmptySessions } from "@/components/EmptySessions";
import { PageShell } from "@/components/ui/PageShell";

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

  const [cycles, catalog, groups] = await Promise.all([
    cycleStore.listCyclesForParticipant(current.clerkUserId),
    itemTypeStore.listItemTypes(),
    cohortStore.listCohortsForUser(current.clerkUserId),
  ]);
  const emojiByKey = new Map(catalog.map((t) => [t.key, t.emoji]));
  const { live, scheduled, recent } = splitSessionListItems(cycles, emojiByKey);
  const isEmpty = live.length === 0 && scheduled.length === 0 && recent.length === 0;

  // The same two-state explanation the chooser gives, rather than this page's
  // old one-liner — a member who lands here from the nav instead of from `/`
  // deserves the same answer to "why is this empty?"
  if (isEmpty) {
    return (
      <PageShell className="justify-center">
        <EmptySessions groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 className="font-display text-42">Sessions</h1>
      <SessionGroups
        live={live}
        scheduled={scheduled}
        recent={recent}
        renderItem={(item) => (
          <Link
            key={item.id}
            href={`/sessions/${item.id}`}
            className="rounded-20 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink"
          >
            <SessionCard {...item} />
          </Link>
        )}
      />
    </PageShell>
  );
}
