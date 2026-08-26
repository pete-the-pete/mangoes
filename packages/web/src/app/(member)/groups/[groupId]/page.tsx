import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { listGroupRosterForMember } from "@/lib/memberGroups";
import {
  splitGroupSessionsByParticipation,
  splitSessionListItems,
} from "@/lib/memberSessions";
import { SessionCard } from "@/components/SessionCard";
import { SessionGroups } from "@/components/SessionGroups";
import { PageShell } from "@/components/ui/PageShell";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Pill";

interface PageProps {
  params: Promise<{ groupId: string }>;
}

/**
 * Read-only roster and session list for a group the caller belongs to.
 * Gated on `cohortStore.getMemberRole` alone — deliberately no platform-owner
 * bypass (unlike the member API's `requireCycleParticipant`): this is a
 * member-facing page about being a participant, not a platform-role surface,
 * and the admin group view already covers the owner/admin case in full.
 * `notFound()` on a failed gate, same as elsewhere, so a non-member can't
 * distinguish "not your group" from "no such group."
 */
export default async function GroupPage({ params }: PageProps) {
  const { groupId } = await params;

  const current = await getCurrentUserRole();
  if (!current) {
    redirect("/sign-in");
  }

  const role = await cohortStore.getMemberRole(groupId, current.clerkUserId);
  if (!role) {
    notFound();
  }

  const group = await cohortStore.getCohort(groupId);
  if (!group) {
    notFound();
  }

  const [members, cycles, catalog] = await Promise.all([
    listGroupRosterForMember(groupId),
    cycleStore.listCyclesForCohort(groupId),
    itemTypeStore.listItemTypes(),
  ]);
  const emojiByKey = new Map(catalog.map((t) => [t.key, t.emoji]));
  const { live, scheduled, recent } = splitSessionListItems(cycles, emojiByKey);

  const { participatingIds, excludedCount } = splitGroupSessionsByParticipation(
    cycles,
    current.clerkUserId,
  );

  return (
    <PageShell className="gap-8">
      <h1 className="font-display text-42">{group.name}</h1>

      <section className="flex flex-col gap-2.5">
        <Label size={12} as="h2" className="text-rust">
          Members
        </Label>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.clerkUserId}>
              <Card
                tone="cream"
                border={4}
                radius={18}
                lift="xs"
                className="flex items-center justify-between gap-3 p-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar src={m.avatarUrl || null} name={m.displayName} size={34} />
                  <span className="font-display text-19 min-w-0 truncate">{m.displayName}</span>
                </span>
                <Pill tone={m.role === "admin" ? "turquoise" : "cream"} className="shrink-0">
                  {m.role}
                </Pill>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {excludedCount > 0 && (
        <Label size={11} as="p" className="text-rust">
          {excludedCount === 1
            ? "One session below doesn't"
            : `${excludedCount} sessions below don't`}{" "}
          have you in the crew, so {excludedCount === 1 ? "it isn't" : "they aren't"} yours to
          open. Ask an admin to add you.
        </Label>
      )}

      <SessionGroups
        live={live}
        scheduled={scheduled}
        recent={recent}
        renderItem={(item) =>
          participatingIds.has(item.id) ? (
            <Link
              key={item.id}
              href={`/sessions/${item.id}`}
              className="rounded-20 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink"
            >
              <SessionCard {...item} />
            </Link>
          ) : (
            <div key={item.id} className="flex flex-col gap-1">
              <div className="opacity-55">
                <SessionCard {...item} />
              </div>
              <Label size={10} className="text-rust pl-1">
                You&rsquo;re not in this one
              </Label>
            </div>
          )
        }
      />
    </PageShell>
  );
}
