import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { cycleStore } from "@/lib/db";
import { splitByStatus } from "@/lib/memberSessions";

export async function GET() {
  const current = await getCurrentUserRole();
  if (!current) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const cycles = await cycleStore.listCyclesForParticipant(current.clerkUserId);
  return NextResponse.json(splitByStatus(cycles));
}
