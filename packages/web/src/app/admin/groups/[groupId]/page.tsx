import { notFound } from "next/navigation";
import { deriveCycleStatus, isCycleOverdue } from "core";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { listGroupMembersForAdmin, listPendingGroupInvites } from "@/lib/adminGroups";
import { MembersPanel } from "./MembersPanel";
import { SessionsPanel, type SessionView } from "./SessionsPanel";
import { PageShell } from "@/components/ui/PageShell";

const WINDOW_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  const group = await cohortStore.getCohort(groupId);
  if (!group) {
    notFound();
  }

  // The page gate mirrors requireCohortRole's second step; the layout has
  // already applied its first (platform owner/admin only).
  const myRole = await cohortStore.getMemberRole(groupId, current.clerkUserId);
  const canManage = current.role === "owner" || myRole === "admin";
  if (!myRole && current.role !== "owner") {
    notFound();
  }

  const [members, invites, cycles, catalog] = await Promise.all([
    listGroupMembersForAdmin(groupId),
    listPendingGroupInvites(groupId),
    cycleStore.listCyclesForCohort(groupId),
    // Whole catalog, not just the enabled slice: a session that already uses a
    // disabled entry keeps rendering it (spec: Schema).
    itemTypeStore.listItemTypes(),
  ]);
  const emojiByKey = new Map(catalog.map((item) => [item.key, item.emoji]));

  const now = new Date();
  const sessions: SessionView[] = cycles.map((cycle) => ({
    id: cycle.id,
    name: cycle.name,
    window: `${WINDOW_FMT.format(cycle.startsAt)} – ${WINDOW_FMT.format(cycle.endsAt)}`,
    status: deriveCycleStatus(cycle, now),
    isOverdue: isCycleOverdue(cycle, now),
    participantCount: cycle.participantIds.length,
    itemEmoji: cycle.itemTypeKeys.map((key) => emojiByKey.get(key) ?? "•"),
  }));

  return (
    <PageShell width="wide" className="gap-8">
      <h1 className="font-display text-48">{group.name}</h1>
      <MembersPanel
        groupId={groupId}
        initialMembers={members}
        initialInvites={invites}
        canManage={canManage}
        currentUserId={current.clerkUserId}
      />
      <SessionsPanel groupId={groupId} sessions={sessions} canManage={canManage} />
    </PageShell>
  );
}
