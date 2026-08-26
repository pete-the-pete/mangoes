import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { listGroupMembersForAdmin } from "@/lib/adminGroups";
import { splitSessionListItems, type SessionListItem } from "@/lib/memberSessions";
import { SessionCard } from "@/components/SessionCard";

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
    listGroupMembersForAdmin(groupId),
    cycleStore.listCyclesForCohort(groupId),
    itemTypeStore.listItemTypes(),
  ]);
  const emojiByKey = new Map(catalog.map((t) => [t.key, t.emoji]));
  const { live, scheduled, recent } = splitSessionListItems(cycles, emojiByKey);

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
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 p-6">
      <h1 className="text-lg font-semibold">{group.name}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-wide text-gray-500 uppercase">Members</h2>
        <ul className="flex flex-col gap-1">
          {members.map((m) => (
            <li key={m.clerkUserId} className="flex items-center justify-between gap-2 border-b border-gray-100 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                {m.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- small avatar, not worth next/image's setup here
                  <img src={m.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                )}
                <span>{m.name ?? m.email ?? m.clerkUserId}</span>
              </span>
              <span className="text-xs text-gray-500">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      {renderGroup("Live", live)}
      {renderGroup("Scheduled", scheduled)}
      {renderGroup("Recent", recent)}
    </div>
  );
}
