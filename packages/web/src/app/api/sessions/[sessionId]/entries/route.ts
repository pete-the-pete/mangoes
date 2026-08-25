import { NextResponse } from "next/server";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { ledgerStore } from "@/lib/db";
import { toEntryJson, DELTA_PAGE_SIZE } from "@/lib/ledgerJson";
import { parseAppendOps, rejectionMessage } from "@/lib/appendOps";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  if (!Number.isInteger(after) || after < 0) {
    return NextResponse.json({ error: "after must be a non-negative integer" }, { status: 400 });
  }

  const page = await ledgerStore.readSince(sessionId, after, DELTA_PAGE_SIZE);
  return NextResponse.json({
    entries: page.entries.map(toEntryJson),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseAppendOps(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Member policy. Admin writes go through the /admin namespace with a different context.
  const result = await ledgerStore.append(
    sessionId,
    {
      actorUserId: guard.clerkUserId,
      canVoidOthers: false,
      canWriteClosed: false,
      canWriteForOthers: false,
    },
    parsed.value,
  );

  return NextResponse.json({
    cursor: result.cursor,
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected: result.rejected.map((r) => ({
      clientEntryId: r.clientEntryId,
      reason: r.reason,
      message: rejectionMessage(r.reason),
    })),
  });
}
