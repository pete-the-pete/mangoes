import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cycleStore, ledgerStore } from "@/lib/db";
import { rejectionMessage } from "@/lib/appendOps";

interface EntryContext {
  params: Promise<{ groupId: string; sessionId: string; entryId: string }>;
}

// Same guard and same 404 rule as the append route. Resolves the target by
// **server** id — an admin is clicking a row the server rendered, so no client
// id exists — then appends a void with canVoidOthers/canWriteClosed true.
export async function POST(_request: Request, context: EntryContext) {
  const { groupId, sessionId, entryId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const cycle = await cycleStore.getCycle(sessionId);
  if (!cycle || cycle.cohortId !== groupId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const target = await ledgerStore.getEntryById(sessionId, entryId);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await ledgerStore.append(
    sessionId,
    { actorUserId: guard.clerkUserId, canVoidOthers: true, canWriteClosed: true, canWriteForOthers: true },
    [
      {
        clientEntryId: randomUUID(),
        kind: "void",
        voidsClientEntryId: target.clientEntryId,
        occurredAt: new Date(),
      },
    ],
  );

  const rejection = result.rejected[0];
  if (rejection) {
    return NextResponse.json({ error: rejectionMessage(rejection.reason) }, { status: 400 });
  }
  return NextResponse.json({ cursor: result.cursor });
}
