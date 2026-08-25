import { NextResponse } from "next/server";
import { wouldRemoveLastCohortAdmin } from "core";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, userRoleStore } from "@/lib/db";

interface RouteContext {
  params: Promise<{ groupId: string; clerkUserId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { groupId, clerkUserId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Checked before the body is parsed, so a malformed body can never override
  // it — same ordering as the shipped platform-role handler.
  if (guard.clerkUserId === clerkUserId) {
    return NextResponse.json(
      { error: "You cannot change your own role" },
      { status: 403 },
    );
  }

  let body: { role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const role = body.role;
  if (role !== "admin" && role !== "member") {
    return NextResponse.json({ error: "Role must be admin or member" }, { status: 400 });
  }

  const members = await cohortStore.listMembers(groupId);

  if (role === "admin") {
    const platformRole = await userRoleStore.getRole(clerkUserId);
    if (platformRole !== "admin" && platformRole !== "owner") {
      return NextResponse.json(
        {
          error:
            "Only platform admins can administer a group — ask a Super Admin to promote them first",
        },
        { status: 400 },
      );
    }
  }

  if (wouldRemoveLastCohortAdmin(members, clerkUserId, { type: "role", role })) {
    return NextResponse.json(
      { error: "This group would be left with no admins" },
      { status: 409 },
    );
  }

  await cohortStore.updateMemberRole(groupId, clerkUserId, role);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { groupId, clerkUserId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Self-removal is allowed, unlike a self role change: leaving a group you're
  // done with is legitimate, stranding it is not — the guard below decides.
  const members = await cohortStore.listMembers(groupId);
  if (wouldRemoveLastCohortAdmin(members, clerkUserId, { type: "remove" })) {
    return NextResponse.json(
      { error: "This group would be left with no admins" },
      { status: 409 },
    );
  }

  await cohortStore.removeMember(groupId, clerkUserId);
  return NextResponse.json({ ok: true });
}
