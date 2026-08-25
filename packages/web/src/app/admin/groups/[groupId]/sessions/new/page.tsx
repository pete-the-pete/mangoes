import { notFound } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, itemTypeStore } from "@/lib/db";
import { listGroupMembersForAdmin } from "@/lib/adminGroups";
import { DEFAULT_ITEM_TYPE_KEY } from "@/lib/itemTypeCatalog";
import { SessionForm } from "../SessionForm";

export default async function NewSessionPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  const myRole = await cohortStore.getMemberRole(groupId, current.clerkUserId);
  const canManage = current.role === "owner" || myRole === "admin";
  if (!canManage) {
    notFound();
  }

  const [itemTypes, members] = await Promise.all([
    itemTypeStore.listItemTypes({ enabledOnly: true }),
    listGroupMembersForAdmin(groupId),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">New session</h1>
      <SessionForm
        groupId={groupId}
        canManage
        defaultItemTypeKey={DEFAULT_ITEM_TYPE_KEY}
        itemTypes={itemTypes.map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }))}
        members={members.map((m) => ({
          clerkUserId: m.clerkUserId,
          name: m.name ?? m.email ?? m.clerkUserId,
        }))}
      />
    </div>
  );
}
