import { NextResponse } from "next/server";
import type { ItemTypeUpdate } from "core";
import { requireRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";

const MAX_LABEL_LENGTH = 40;

interface RouteContext {
  params: Promise<{ key: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireRole(["owner"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { key } = await context.params;

  let body: { enabled?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: ItemTypeUpdate = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    update.enabled = body.enabled;
  }

  if (body.label !== undefined) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label || label.length > MAX_LABEL_LENGTH) {
      return NextResponse.json(
        { error: `Label must be 1-${MAX_LABEL_LENGTH} characters` },
        { status: 400 },
      );
    }
    update.label = label;
  }

  if (update.enabled === undefined && update.label === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const itemType = await itemTypeStore.updateItemType(key, update);
  if (!itemType) {
    return NextResponse.json({ error: "Item type not found" }, { status: 404 });
  }
  return NextResponse.json({ itemType });
}
