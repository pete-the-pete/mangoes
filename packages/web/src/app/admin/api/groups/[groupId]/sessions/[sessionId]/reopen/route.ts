import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cycleStore } from "@/lib/db";
import { toSessionJson } from "@/lib/sessions";

interface RouteContext {
  params: Promise<{ groupId: string; sessionId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { groupId, sessionId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const current = await cycleStore.getCycle(sessionId);
  if (!current || current.cohortId !== groupId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const reopened = await cycleStore.reopenCycle(sessionId);
  if (!reopened) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ session: toSessionJson(reopened) });
}
