import Link from "next/link";
import { getCurrentUserRole } from "@/lib/auth";
import { cycleStore, itemTypeStore } from "@/lib/db";
import { splitSessionListItems } from "@/lib/memberSessions";
import { SessionCard } from "@/components/SessionCard";
import { SessionGroups } from "@/components/SessionGroups";
import { ButtonLink } from "@/components/ui/Button";
import { PageShell } from "@/components/ui/PageShell";
import { Label } from "@/components/ui/Label";

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

  return (
    <PageShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-42">Sessions</h1>
        {/* The only member-facing route to /account: members have no
            persistent nav, and this is the list screen they always pass
            through. */}
        <ButtonLink href="/account" tone="secondary" size="sm">
          Account
        </ButtonLink>
      </div>
      {isEmpty && (
        <Label size={11} as="p" className="text-rust">
          No sessions yet — an admin will add you to one.
        </Label>
      )}
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
