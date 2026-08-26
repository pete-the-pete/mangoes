import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { parseNameField } from "@/lib/userName";

/**
 * The signed-in user's own profile. Any role may call it — this is the one
 * write in the app that isn't gated on `requireRole`, because the resource is
 * the caller.
 *
 * The target is always `auth()`'s user id and never anything from the body: a
 * route that took an id from its input would be an "edit anyone's name"
 * endpoint wearing a `/me` label.
 */
export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

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

  // `""` rather than omitting the field: blank has to actually clear the name
  // in Clerk, or a user could set a name and never take it back off. Peers
  // then see UNNAMED_MEMBER, which is a state they're entitled to return to.
  try {
    const clerk = await clerkClient();
    await clerk.users.updateUser(userId, {
      firstName: firstName.value ?? "",
      lastName: lastName.value ?? "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save your name";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    firstName: firstName.value ?? "",
    lastName: lastName.value ?? "",
  });
}
