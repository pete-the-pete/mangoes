import Link from "next/link";
import { notFound } from "next/navigation";
import { deriveCycleStatus, isCycleOverdue } from "core";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { listGroupMembersForAdmin } from "@/lib/adminGroups";
import { DEFAULT_ITEM_TYPE_KEY } from "@/lib/itemTypeCatalog";
import { SessionForm } from "../SessionForm";

/**
 * The `"YYYY-MM-DDTHH:mm"` shape `datetime-local` requires, in UTC.
 *
 * UTC rather than the viewer's zone, deliberately: formatting on the server in
 * the *server's* zone is a hydration mismatch waiting to happen, and a session
 * window is group-wide — an unambiguous labelled time beats a silent local-time
 * guess for two admins in two places. The form's fields say "(UTC)" and it
 * appends the "Z" back on submit.
 */
function toUtcInputValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ groupId: string; sessionId: string }>;
}) {
  const { groupId, sessionId } = await params;
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  const myRole = await cohortStore.getMemberRole(groupId, current.clerkUserId);
  const isOwner = current.role === "owner";
  if (!myRole && !isOwner) {
    notFound();
  }
  const canManage = isOwner || myRole === "admin";

  const cycle = await cycleStore.getCycle(sessionId);
  // A session from another group is a 404, not a 403 — the same rule the API
  // enforces, so the two cases stay indistinguishable by probing.
  if (!cycle || cycle.cohortId !== groupId) {
    notFound();
  }

  const [catalog, members] = await Promise.all([
    itemTypeStore.listItemTypes({ enabledOnly: true }),
    listGroupMembersForAdmin(groupId),
  ]);

  // A disabled entry leaves the picker but keeps rendering on the session that
  // already uses it (spec: Schema), so its option is added back for this form.
  const enabledKeys = new Set(catalog.map((t) => t.key));
  const missing = cycle.itemTypeKeys.filter((key) => !enabledKeys.has(key));
  const options = [...catalog];
  if (missing.length > 0) {
    const full = await itemTypeStore.listItemTypes();
    options.push(...full.filter((t) => missing.includes(t.key)));
  }

  const now = new Date();

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <Link
        href={`/admin/groups/${groupId}`}
        className="text-sm text-gray-500 hover:underline"
      >
        ← Back to the group
      </Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold">{cycle.name}</h1>
      <SessionForm
        groupId={groupId}
        canManage={canManage}
        defaultItemTypeKey={DEFAULT_ITEM_TYPE_KEY}
        itemTypes={options.map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }))}
        members={members.map((m) => ({
          clerkUserId: m.clerkUserId,
          name: m.name ?? m.email ?? m.clerkUserId,
        }))}
        session={{
          id: cycle.id,
          name: cycle.name,
          startsAt: toUtcInputValue(cycle.startsAt),
          endsAt: toUtcInputValue(cycle.endsAt),
          status: deriveCycleStatus(cycle, now),
          isOverdue: isCycleOverdue(cycle, now),
          itemTypeKeys: cycle.itemTypeKeys,
          participantIds: cycle.participantIds,
        }}
      />
    </div>
  );
}
