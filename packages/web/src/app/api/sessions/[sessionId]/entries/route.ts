import { NextResponse } from "next/server";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { ledgerStore } from "@/lib/db";
import { toEntryJson, DELTA_PAGE_SIZE } from "@/lib/ledgerJson";

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
