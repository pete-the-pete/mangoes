import Link from "next/link";
import { notFound } from "next/navigation";
import { deriveCycleStatus, isCycleOverdue } from "core";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore, itemTypeStore, ledgerStore } from "@/lib/db";
import { listGroupMembersForAdmin } from "@/lib/adminGroups";
import { DEFAULT_ITEM_TYPE_KEY } from "@/lib/itemTypeCatalog";
import { SessionForm } from "../SessionForm";
import { AdminLogControl, type AdminEntryView } from "./AdminLogControl";

/** How many recent ledger entries the session page pulls for the admin log control. */
const RECENT_ENTRIES_LIMIT = 50;

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

  // readSince is head-anchored (WHERE seq > after, ascending) — reading from 0
  // gives the OLDEST entries, not the recent ones. snapshot().cursor is the
  // cycle's current max seq (see fold.test.ts / ledgerStore.test.ts's
  // fold-vs-SQL cross-check), so it anchors a tail window instead. A void
  // always has a higher seq than the log it targets, so this window can never
  // show a voided log as still-live — the head window had the opposite bug.
  const [catalog, members, snapshot] = await Promise.all([
    itemTypeStore.listItemTypes({ enabledOnly: true }),
    listGroupMembersForAdmin(groupId),
    ledgerStore.snapshot(sessionId),
  ]);
  const entriesPage = await ledgerStore.readSince(
    sessionId,
    Math.max(0, snapshot.cursor - RECENT_ENTRIES_LIMIT),
    RECENT_ENTRIES_LIMIT,
  );

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

  const memberOptions = members.map((m) => ({
    clerkUserId: m.clerkUserId,
    name: m.name ?? m.email ?? m.clerkUserId,
  }));
  const nameByClerkUserId = Object.fromEntries(memberOptions.map((m) => [m.clerkUserId, m.name]));

  // The admin log control's item and person pickers are scoped to what this
  // session actually tracks — the append route 400s anything outside it.
  const sessionItemTypes = options
    .filter((t) => cycle.itemTypeKeys.includes(t.key))
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }));
  const sessionParticipants = memberOptions.filter((m) =>
    cycle.participantIds.includes(m.clerkUserId),
  );

  // Newest first, for the recent-entries list.
  const recentEntries: AdminEntryView[] = [...entriesPage.entries].reverse().map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    itemTypeKey: entry.itemTypeKey,
    subjectUserId: entry.subjectUserId,
    actorUserId: entry.actorUserId,
    voidsEntryId: entry.voidsEntryId,
    occurredAt: entry.occurredAt.toISOString(),
  }));

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
        members={memberOptions}
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
      <AdminLogControl
        groupId={groupId}
        sessionId={sessionId}
        canManage={canManage}
        itemTypes={sessionItemTypes}
        participants={sessionParticipants}
        nameByClerkUserId={nameByClerkUserId}
        entries={recentEntries}
      />
    </div>
  );
}
