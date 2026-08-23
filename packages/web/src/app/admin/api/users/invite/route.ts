import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth";

const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;

export async function POST(request: Request) {
  const guard = await requireRole(["owner"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: { email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = body.role;

  if (!GMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { error: "Email must be a @gmail.com address" },
      { status: 400 },
    );
  }
  if (role !== "admin" && role !== "member") {
    return NextResponse.json(
      { error: "Role must be admin or member" },
      { status: 400 },
    );
  }

  const clerk = await clerkClient();
  try {
    await clerk.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { intendedRole: role },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create invitation";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
