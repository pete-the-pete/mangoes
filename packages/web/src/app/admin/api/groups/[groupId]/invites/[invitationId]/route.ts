import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireCohortRole } from "@/lib/cohortAuth";

interface RouteContext {
  params: Promise<{ groupId: string; invitationId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { groupId, invitationId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const clerk = await clerkClient();
  try {
    await clerk.invitations.revokeInvitation(invitationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clerk request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
