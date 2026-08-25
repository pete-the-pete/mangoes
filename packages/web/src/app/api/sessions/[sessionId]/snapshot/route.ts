import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, ledgerStore, itemTypeStore } from "@/lib/db";
import { toMemberSessionJson } from "@/lib/memberSessions";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cycle = await cycleStore.getCycle(sessionId);
  if (!cycle) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const [aggregate, catalog, clerk] = await Promise.all([
    ledgerStore.snapshot(sessionId),
    itemTypeStore.listItemTypes({ enabledOnly: false }),
    clerkClient(),
  ]);

  // Identity is joined server-side, the way adminUsers.ts already does it — the
  // client never gets a Clerk key and never makes a Clerk call.
  //
  // Guard the empty case explicitly rather than passing `userId: []` through:
  // Clerk's filter is "match any of these IDs," and an empty array is not
  // guaranteed to mean "match none" — it could just as easily mean "no filter,"
  // which would leak up to 100 arbitrary instance users into this response. A
  // participantless cycle is reachable here because the platform-owner
  // superuser bypasses the participation check in requireCycleParticipant.
  const users =
    cycle.participantIds.length === 0
      ? { data: [] }
      : await clerk.users.getUserList({ userId: cycle.participantIds, limit: 100 });

  // Clerk's getUserList does not document a stable order for its response, so
  // deriving `participants` from `users.data` directly would let the member
  // list visibly reorder on every poll. Index by id and walk cycle.participantIds
  // instead — the order the cycle itself defines, which is stable across polls
  // and matches what admin already shows. This also means a Clerk response that
  // somehow carried an id outside participantIds is dropped rather than surfaced.
  const byClerkId = new Map(users.data.map((u) => [u.id, u]));
  const participants = cycle.participantIds
    .map((id) => byClerkId.get(id))
    .filter((u): u is NonNullable<typeof u> => u !== undefined)
    .map((u) => ({
      clerkUserId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.primaryEmailAddress?.emailAddress || u.id,
      imageUrl: u.imageUrl,
    }));

  // Item types come from the cycle's own itemTypeKeys, not the enabled catalog —
  // v0.2 decided disabling an entry is picker-only, so a session already tracking
  // a disabled item keeps rendering it.
  const itemTypes = cycle.itemTypeKeys
    .map((key) => catalog.find((t) => t.key === key))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }));

  return NextResponse.json({
    session: toMemberSessionJson(cycle),
    cursor: aggregate.cursor,
    counts: aggregate.counts,
    itemTypes,
    participants,
  });
}
