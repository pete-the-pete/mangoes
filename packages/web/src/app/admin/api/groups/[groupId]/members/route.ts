import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore } from "@/lib/db";
import { isGmailAddress } from "@/lib/email";
import { parseNameField } from "@/lib/userName";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: { email?: unknown; firstName?: unknown; lastName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isGmailAddress(email)) {
    return NextResponse.json(
      { error: "Email must be a @gmail.com address" },
      { status: 400 },
    );
  }

  const firstName = parseNameField(body.firstName, "First name");
  if (!firstName.ok) {
    return NextResponse.json({ error: firstName.error }, { status: 400 });
  }
  const lastName = parseNameField(body.lastName, "Last name");
  if (!lastName.ok) {
    return NextResponse.json({ error: lastName.error }, { status: 400 });
  }

  const clerk = await clerkClient();
  try {
    const { data: existing } = await clerk.users.getUserList({
      emailAddress: [email],
    });
    const user = existing[0];

    if (user) {
      // Deliberately not applying the name here. This person already has an
      // account, and adding someone to a group is not a licence to rename
      // them — the name only ever rides on an invitation.
      await cohortStore.addMember(groupId, user.id, "member");
      return NextResponse.json({ added: true, clerkUserId: user.id }, { status: 201 });
    }

    // No local row is pre-created for an invite that may never be accepted —
    // the group id rides along in metadata and is consumed on first sign-in.
    // Same metadata channel the platform invite uses for a name, plus the
    // group id this route already rode along — both consumed on first sign-in.
    const publicMetadata: Record<string, string> = {
      intendedRole: "member",
      intendedCohortId: groupId,
    };
    if (firstName.value) {
      publicMetadata["intendedFirstName"] = firstName.value;
    }
    if (lastName.value) {
      publicMetadata["intendedLastName"] = lastName.value;
    }

    await clerk.invitations.createInvitation({
      emailAddress: email,
      publicMetadata,
    });
    return NextResponse.json({ invited: true, email }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clerk request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
