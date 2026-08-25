import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { parseUpdateSession, toSessionJson } from "@/lib/sessions";

interface RouteContext {
  params: Promise<{ groupId: string; sessionId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { groupId, sessionId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // A session id from another group is a 404, not a 403 — the two cases must
  // not be distinguishable by probing.
  const current = await cycleStore.getCycle(sessionId);
  if (!current || current.cohortId !== groupId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [members, enabled] = await Promise.all([
    cohortStore.listMembers(groupId),
    itemTypeStore.listItemTypes({ enabledOnly: true }),
  ]);

  const parsed = parseUpdateSession(
    body,
    {
      memberIds: members.map((m) => m.clerkUserId),
      enabledKeys: enabled.map((t) => t.key),
    },
    { startsAt: current.startsAt, endsAt: current.endsAt },
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await cycleStore.updateCycle(sessionId, parsed.value);
  if (!updated) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ session: toSessionJson(updated) });
}
