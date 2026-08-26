import { getCurrentUserRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";
import { ItemTypeTable } from "./ItemTypeTable";
import { PageShell } from "@/components/ui/PageShell";
import { Label } from "@/components/ui/Label";

export default async function ItemTypesPage() {
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  // The nav hides this link for admins; this is the gate that enforces it.
  if (current.role !== "owner") {
    return (
      <PageShell width="wide" surface="ink-deep" className="items-center justify-center text-center">
        <span aria-hidden="true" className="text-[4.5rem] leading-none">
          👑
        </span>
        <h1 className="font-display text-mango-yellow text-42">Not authorized</h1>
        <Label size={11} as="p" className="text-cream/70">
          Only a Super Admin can curate the item type catalog.
        </Label>
      </PageShell>
    );
  }

  const itemTypes = await itemTypeStore.listItemTypes();

  return (
    <PageShell width="wide" className="gap-4">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-48">Item types</h1>
        <p className="text-12 text-rust max-w-prose leading-snug">
          Disabled entries disappear from the session picker. Sessions that already use one keep
          working.
        </p>
      </header>
      <ItemTypeTable initialItemTypes={itemTypes} />
    </PageShell>
  );
}
