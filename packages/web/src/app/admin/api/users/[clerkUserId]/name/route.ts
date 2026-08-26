import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth";
import { parseNameField } from "@/lib/userName";

/**
 * Sets a user's display name from the admin roster — the only way to give a
 * name to someone who was invited before their name was asked for, without
 * waiting for them to sign in and set it themselves on /account.
 *
 * Open to admins as well as owners, and with no self-edit block: unlike a role
 * change, renaming carries no privilege, so the role route's guards would be
 * ceremony here. Renaming is fully reversible by the user on /account.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clerkUserId: string }> },
) {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { clerkUserId } = await params;

  let body: { firstName?: unknown; lastName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const firstName = parseNameField(body.firstName, "First name");
  if (!firstName.ok) {
    return NextResponse.json({ error: firstName.error }, { status: 400 });
  }
  const lastName = parseNameField(body.lastName, "Last name");
  if (!lastName.ok) {
    return NextResponse.json({ error: lastName.error }, { status: 400 });
  }

  try {
    const clerk = await clerkClient();
    await clerk.users.updateUser(clerkUserId, {
      firstName: firstName.value ?? "",
      lastName: lastName.value ?? "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save the name";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    firstName: firstName.value ?? "",
    lastName: lastName.value ?? "",
  });
}
