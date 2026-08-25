import { UNTAGGED, type Aggregate, type LedgerEntry, type SubjectKey } from "./types.js";

export function emptyAggregate(): Aggregate {
  return { cursor: 0, counts: {} };
}

/**
 * Folds a delta stream into per-subject, per-item counts.
 *
 * Pure: never mutates its input and never touches I/O. That matters because this
 * is the one piece of the sync path that runs identically on the server and on
 * every client, and it is cheap to test exhaustively.
 *
 * Entries at or below the aggregate's cursor are skipped, which is what makes
 * overlap harmless — the same entry can arrive from the snapshot, from a polled
 * delta, and from an SSE push, and it is only ever counted once.
 */
export function foldEntries(aggregate: Aggregate, entries: LedgerEntry[]): Aggregate {
  let cursor = aggregate.cursor;
  const counts: Record<SubjectKey, Record<string, number>> = {};
  for (const [subject, byItem] of Object.entries(aggregate.counts)) {
    counts[subject] = { ...byItem };
  }

  for (const entry of entries) {
    if (entry.seq <= aggregate.cursor) continue;
    // null subject is untagged: it lands under UNTAGGED, so it counts toward the
    // group total without crediting anyone.
    const subject = entry.subjectUserId ?? UNTAGGED;
    const byItem = (counts[subject] ??= {});
    byItem[entry.itemTypeKey] = (byItem[entry.itemTypeKey] ?? 0) + (entry.kind === "log" ? 1 : -1);
    if (entry.seq > cursor) cursor = entry.seq;
  }

  return { cursor, counts };
}

/** One subject's count for one item type. */
export function subjectTotal(
  aggregate: Aggregate,
  subject: SubjectKey,
  itemTypeKey: string,
): number {
  return aggregate.counts[subject]?.[itemTypeKey] ?? 0;
}

/** Every subject's count for one item type, untagged entries included. */
export function groupTotal(aggregate: Aggregate, itemTypeKey: string): number {
  let total = 0;
  for (const byItem of Object.values(aggregate.counts)) {
    total += byItem[itemTypeKey] ?? 0;
  }
  return total;
}
