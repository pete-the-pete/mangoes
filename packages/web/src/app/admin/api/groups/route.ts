import { NextResponse } from "next/server";
import type { Cohort } from "core";
import { requireRole } from "@/lib/auth";
import { cohortStore } from "@/lib/db";

const MAX_NAME_LENGTH = 80;

function toGroupJson(cohort: Cohort) {
  return { id: cohort.id, name: cohort.name, createdAt: cohort.createdAt.toISOString() };
}

export async function GET() {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // The owner administers the whole instance; an admin sees only what they're in.
  const cohorts =
    guard.role === "owner"
      ? await cohortStore.listCohorts()
      : await cohortStore.listCohortsForUser(guard.clerkUserId);

  return NextResponse.json({ groups: cohorts.map(toGroupJson) });
}

export async function POST(request: Request) {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok || !guard.clerkUserId) {
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

  const cohort = await cohortStore.createCohort({ name, createdBy: guard.clerkUserId });
  return NextResponse.json({ group: toGroupJson(cohort) }, { status: 201 });
}
