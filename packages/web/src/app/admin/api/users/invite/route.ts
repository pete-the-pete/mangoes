import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth";
import { isGmailAddress } from "@/lib/email";

/**
 * The public origin this request arrived on, used to build the invitation's
 * return link.
 *
 * Deliberately not `new URL(request.url).origin`. Behind a TLS-terminating
 * proxy Next reports the *internal* host with the *external* scheme: measured
 * over `tailscale serve`, `request.url` is `https://localhost:3000` while the
 * browser is on `https://<machine>.<tailnet>.ts.net`. That mismatch would bake
 * a dead link into every invitation email, so read the forwarded headers the
 * proxy actually sets and fall back only when there are none.
 */
function requestOrigin(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) {
    return new URL(request.url).origin;
  }
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

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

  if (!isGmailAddress(email)) {
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
      // Without this Clerk finishes the whole invite flow on its own Account
      // Portal and drops the invitee on `accounts.dev/default-redirect`, never
      // touching this app. Must be absolute: a relative path resolves against
      // Clerk's domain, not ours (verified — it 404s there).
      redirectUrl: `${requestOrigin(request)}/sign-up`,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create invitation";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
