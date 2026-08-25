import { getCurrentUserRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";
import { ItemTypeTable } from "./ItemTypeTable";

export default async function ItemTypesPage() {
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  // The nav hides this link for admins; this is the gate that enforces it.
  if (current.role !== "owner") {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-gray-500">
          Only a Super Admin can curate the item type catalog.
        </p>
      </div>
    );
  }

  const itemTypes = await itemTypeStore.listItemTypes();

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-semibold">Item types</h1>
      <p className="mb-4 text-sm text-gray-500">
        Disabled entries disappear from the session picker. Sessions that already
        use one keep working.
      </p>
      <ItemTypeTable initialItemTypes={itemTypes} />
    </div>
  );
}
