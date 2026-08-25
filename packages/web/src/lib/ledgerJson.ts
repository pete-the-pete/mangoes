import type { LedgerEntry } from "core";

/** Page size for the delta endpoint and the SSE stream, which reuses it. */
export const DELTA_PAGE_SIZE = 500;

export interface EntryJson {
  id: string;
  seq: number;
  kind: "log" | "void";
  itemTypeKey: string;
  subjectUserId: string | null;
  actorUserId: string;
  clientEntryId: string;
  occurredAt: string;
}

export function toEntryJson(entry: LedgerEntry): EntryJson {
  return {
    id: entry.id,
    seq: entry.seq,
    kind: entry.kind,
    itemTypeKey: entry.itemTypeKey,
    subjectUserId: entry.subjectUserId,
    actorUserId: entry.actorUserId,
    clientEntryId: entry.clientEntryId,
    occurredAt: entry.occurredAt.toISOString(),
  };
}
