import type { Cycle, CycleStatus } from "./types.js";

type CycleWindow = Pick<Cycle, "startsAt" | "endsAt" | "closedAt">;

/**
 * `closedAt` is the only durable fact; everything else is read off the clock.
 * A cycle past `endsAt` that nobody closed is still `live` — closing is an
 * explicit act, and the end time only prompts for it.
 */
export function deriveCycleStatus(cycle: CycleWindow, now: Date): CycleStatus {
  if (cycle.closedAt !== null) {
    return "closed";
  }
  return now.getTime() < cycle.startsAt.getTime() ? "scheduled" : "live";
}

/** Open, but past its end time — the UI prompts an admin to close it. */
export function isCycleOverdue(cycle: CycleWindow, now: Date): boolean {
  return cycle.closedAt === null && now.getTime() > cycle.endsAt.getTime();
}
