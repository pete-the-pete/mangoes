import { notFound } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, itemTypeStore } from "@/lib/db";
import { listGroupMembersForAdmin } from "@/lib/adminGroups";
import { DEFAULT_ITEM_TYPE_KEY } from "@/lib/itemTypeCatalog";
import { SessionForm } from "../SessionForm";
import { PageShell } from "@/components/ui/PageShell";
import { Label } from "@/components/ui/Label";

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
    <PageShell width="wide">
      <header className="flex flex-col gap-1.5">
        <Label size={10} className="text-rust">
          Group admin
        </Label>
        <h1 className="font-display text-52">New session</h1>
      </header>
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
    </PageShell>
  );
}
