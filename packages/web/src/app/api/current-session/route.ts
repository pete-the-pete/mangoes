import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { currentCycleStore, cycleStore } from "@/lib/db";
import { toMemberSessionJson } from "@/lib/memberSessions";

export async function GET() {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const cycle = await currentCycleStore.getCurrentCycle(current.clerkUserId);
  // A stale pointer resolves to null, never an error — the client renders the chooser.
  return NextResponse.json({ session: cycle ? toMemberSessionJson(cycle) : null });
}

export async function PUT(request: Request) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = (body as { sessionId?: unknown }).sessionId;
  if (sessionId === null) {
    await currentCycleStore.clearCurrentCycle(current.clerkUserId);
    return NextResponse.json({ session: null });
  }
  if (typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId must be a string or null" }, { status: 400 });
  }

  if (!(await cycleStore.isCycleParticipant(sessionId, current.clerkUserId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await currentCycleStore.setCurrentCycle(current.clerkUserId, sessionId);
  const cycle = await currentCycleStore.getCurrentCycle(current.clerkUserId);
  return NextResponse.json({ session: cycle ? toMemberSessionJson(cycle) : null });
}
