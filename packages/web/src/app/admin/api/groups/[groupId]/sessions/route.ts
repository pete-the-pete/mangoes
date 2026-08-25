import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { parseCreateSession, toSessionJson } from "@/lib/sessions";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin", "member"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cycles = await cycleStore.listCyclesForCohort(groupId);
  const now = new Date();
  return NextResponse.json({ sessions: cycles.map((c) => toSessionJson(c, now)) });
}

export async function POST(request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Both lists are read fresh: an admin's picker may be stale, and the catalog
  // can be disabled out from under them between page load and submit.
  const [members, enabled] = await Promise.all([
    cohortStore.listMembers(groupId),
    itemTypeStore.listItemTypes({ enabledOnly: true }),
  ]);

  const parsed = parseCreateSession(body, {
    memberIds: members.map((m) => m.clerkUserId),
    enabledKeys: enabled.map((t) => t.key),
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const cycle = await cycleStore.createCycle({
    cohortId: groupId,
    createdBy: guard.clerkUserId,
    ...parsed.value,
  });
  return NextResponse.json({ session: toSessionJson(cycle) }, { status: 201 });
}
