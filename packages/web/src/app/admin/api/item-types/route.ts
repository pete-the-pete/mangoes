import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const enabledOnly = new URL(request.url).searchParams.get("enabled") === "true";
  const itemTypes = await itemTypeStore.listItemTypes(
    enabledOnly ? { enabledOnly: true } : undefined,
  );
  return NextResponse.json({ itemTypes });
}
