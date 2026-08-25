import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore } from "@/lib/db";
import { isGmailAddress } from "@/lib/email";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: { email?: unknown };
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

  const clerk = await clerkClient();
  try {
    const { data: existing } = await clerk.users.getUserList({
      emailAddress: [email],
    });
    const user = existing[0];

    if (user) {
      await cohortStore.addMember(groupId, user.id, "member");
      return NextResponse.json({ added: true, clerkUserId: user.id }, { status: 201 });
    }

    // No local row is pre-created for an invite that may never be accepted —
    // the group id rides along in metadata and is consumed on first sign-in.
    await clerk.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { intendedRole: "member", intendedCohortId: groupId },
    });
    return NextResponse.json({ invited: true, email }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clerk request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
