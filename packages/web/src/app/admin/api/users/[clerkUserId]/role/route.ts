import { NextResponse } from "next/server";
import { wouldRemoveLastOwner, type Role } from "core";
import { requireRole } from "@/lib/auth";
import { userRoleStore } from "@/lib/db";

const VALID_ROLES: Role[] = ["owner", "admin", "member"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clerkUserId: string }> },
) {
  const guard = await requireRole(["owner"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { clerkUserId } = await params;

  // Authorization rule, checked before the body is parsed: a malformed body
  // must not change the answer to "can this caller do this at all."
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
  const newRole = body.role;

  if (!VALID_ROLES.includes(newRole as Role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const currentRoles = await userRoleStore.listRoles();
  if (wouldRemoveLastOwner(currentRoles, clerkUserId, newRole as Role)) {
    return NextResponse.json(
      { error: "Cannot remove the last remaining Super Admin" },
      { status: 409 },
    );
  }

  await userRoleStore.upsertRole(clerkUserId, newRole as Role);
  return NextResponse.json({ ok: true });
}
