import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore } from "@/lib/db";

const MAX_NAME_LENGTH = 80;

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin", "member"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cohort = await cohortStore.getCohort(groupId);
  if (!cohort) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
  const members = await cohortStore.listMembers(groupId);

  return NextResponse.json({
    group: {
      id: cohort.id,
      name: cohort.name,
      createdAt: cohort.createdAt.toISOString(),
    },
    members: members.map((m) => ({ clerkUserId: m.clerkUserId, role: m.role })),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be 1-${MAX_NAME_LENGTH} characters` },
      { status: 400 },
    );
  }

  const cohort = await cohortStore.renameCohort(groupId, name);
  if (!cohort) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
  return NextResponse.json({
    group: {
      id: cohort.id,
      name: cohort.name,
      createdAt: cohort.createdAt.toISOString(),
    },
  });
}
