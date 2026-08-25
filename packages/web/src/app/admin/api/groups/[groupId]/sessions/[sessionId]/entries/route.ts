import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cycleStore, ledgerStore } from "@/lib/db";
import { rejectionMessage } from "@/lib/appendOps";

interface RouteContext {
  params: Promise<{ groupId: string; sessionId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { groupId, sessionId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cycle = await cycleStore.getCycle(sessionId);
  // A session that does not belong to the named group is a plain 404, so the two
  // cases are not distinguishable by probing — v0.2's rule, kept.
  if (!cycle || cycle.cohortId !== groupId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { itemTypeKey, subjectUserId } = body as {
    itemTypeKey?: unknown;
    subjectUserId?: unknown;
  };
  if (typeof itemTypeKey !== "string" || !cycle.itemTypeKeys.includes(itemTypeKey)) {
    return NextResponse.json({ error: "That item is not tracked in this session" }, { status: 400 });
  }
  // null is meaningful — it is the untagged, "for the group" case.
  if (subjectUserId !== null && typeof subjectUserId !== "string") {
    return NextResponse.json({ error: "subjectUserId must be a user id or null" }, { status: 400 });
  }
  if (typeof subjectUserId === "string" && !cycle.participantIds.includes(subjectUserId)) {
    return NextResponse.json({ error: "That person is not in this session" }, { status: 400 });
  }

  const result = await ledgerStore.append(
    sessionId,
    {
      actorUserId: guard.clerkUserId,
      canVoidOthers: true,
      canWriteClosed: true, // vision Must Have: admins amend closed sessions
      canWriteForOthers: true,
    },
    [{ clientEntryId: randomUUID(), kind: "log", itemTypeKey, subjectUserId, occurredAt: new Date() }],
  );

  const rejection = result.rejected[0];
  if (rejection) {
    return NextResponse.json({ error: rejectionMessage(rejection.reason) }, { status: 400 });
  }
  return NextResponse.json({ cursor: result.cursor }, { status: 201 });
}
