import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/adminUsers";

export async function GET() {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const users = await listUsersForAdmin();
  return NextResponse.json({ users });
}
