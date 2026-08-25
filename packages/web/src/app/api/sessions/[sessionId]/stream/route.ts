import { requireCycleParticipant } from "@/lib/cycleAuth";
import { ledgerStore } from "@/lib/db";
import { toEntryJson, DELTA_PAGE_SIZE } from "@/lib/ledgerJson";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

const POLL_MS = 2000;
const MAX_LIFETIME_MS = 5 * 60 * 1000;

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    return new Response(JSON.stringify({ error: guard.error }), {
      status: guard.status,
      headers: { "content-type": "application/json" },
    });
  }

  let cursor = Number(new URL(request.url).searchParams.get("after") ?? "0");
  if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const started = Date.now();
      let closed = false;
      // Declared before `finish` so a future reorder of the block below can't
      // reintroduce a TDZ read — `finish` closes over this by reference either way.
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (closed) return;
        closed = true;
        if (timer !== undefined) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      request.signal.addEventListener("abort", finish);

      // Deliberately a short poll against Postgres rather than LISTEN/NOTIFY: a
      // dedicated LISTEN connection per subscriber does not survive a serverless
      // deployment or a connection pooler, and this endpoint is a liveness
      // enhancement, not the correctness path.
      //
      // Self-scheduling setTimeout, not setInterval: the next poll is only
      // scheduled once the current one has fully settled, so a readSince call
      // that runs longer than POLL_MS can never overlap with the next tick.
      // Two ticks racing on the shared `cursor` closure is exactly what let a
      // slow, stale read finish after a faster later one and regress the
      // cursor — a correctness bug for a value the sync client treats as
      // monotonic.
      const poll = async () => {
        if (closed) return;
        if (Date.now() - started > MAX_LIFETIME_MS) {
          // EventSource reconnects on its own; capping lifetime keeps a stuck
          // function from living forever.
          finish();
          return;
        }
        try {
          const page = await ledgerStore.readSince(sessionId, cursor, DELTA_PAGE_SIZE);
          // The stream may have been aborted while readSince was in flight.
          if (closed) return;
          if (page.entries.length > 0) {
            // Monotonic by construction — readSince("after" = cursor) never
            // returns a nextCursor below the cursor it was called with — but
            // stated explicitly rather than relying on that alone: this value
            // must never move backward regardless of how the store evolves.
            cursor = Math.max(cursor, page.nextCursor);
            const payload = JSON.stringify({
              entries: page.entries.map(toEntryJson),
              nextCursor: page.nextCursor,
              hasMore: page.hasMore,
            });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } else {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        } catch {
          finish();
          return;
        }
        if (!closed) timer = setTimeout(poll, POLL_MS);
      };

      timer = setTimeout(poll, POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
