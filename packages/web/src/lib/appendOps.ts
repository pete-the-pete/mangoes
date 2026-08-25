import type { AppendOp, RejectReason } from "core";

export const MAX_BATCH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseAppendOps(body: unknown): ParseResult<AppendOp[]> {
  const ops = (body as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) return { ok: false, error: "ops must be an array" };
  if (ops.length === 0) return { ok: false, error: "ops must not be empty" };
  if (ops.length > MAX_BATCH) return { ok: false, error: `ops must contain at most ${MAX_BATCH} entries` };

  const parsed: AppendOp[] = [];
  for (const raw of ops as Record<string, unknown>[]) {
    const clientEntryId = raw["clientEntryId"];
    if (typeof clientEntryId !== "string" || !UUID.test(clientEntryId)) {
      return { ok: false, error: "clientEntryId must be a UUID" };
    }
    // Members never log for anyone else. canWriteForOthers is the backstop.
    if ("subjectUserId" in raw) {
      return { ok: false, error: "subjectUserId is not accepted on this endpoint" };
    }
    const occurredAtRaw = raw["occurredAt"];
    if (typeof occurredAtRaw !== "string" || Number.isNaN(Date.parse(occurredAtRaw))) {
      return { ok: false, error: "occurredAt must be an ISO timestamp" };
    }
    const occurredAt = new Date(occurredAtRaw);
    const kind = raw["kind"];

    if (kind === "log") {
      const itemTypeKey = raw["itemTypeKey"];
      if (typeof itemTypeKey !== "string" || itemTypeKey.length === 0) {
        return { ok: false, error: "itemTypeKey is required for a log op" };
      }
      parsed.push({ clientEntryId, kind: "log", itemTypeKey, occurredAt });
    } else if (kind === "void") {
      const voidsClientEntryId = raw["voidsClientEntryId"];
      if (typeof voidsClientEntryId !== "string" || !UUID.test(voidsClientEntryId)) {
        return { ok: false, error: "voidsClientEntryId must be a UUID" };
      }
      parsed.push({ clientEntryId, kind: "void", voidsClientEntryId, occurredAt });
    } else {
      return { ok: false, error: 'kind must be "log" or "void"' };
    }
  }
  return { ok: true, value: parsed };
}

/** Core speaks Cycle; the member-facing copy says Session. */
export function rejectionMessage(reason: RejectReason): string {
  switch (reason) {
    case "cycle_closed": return "Only a session admin can amend a closed session";
    case "unknown_target": return "That log no longer exists";
    case "not_your_entry": return "You can only change your own logs";
    case "already_voided": return "That log was already removed";
    case "unknown_item_type": return "That item is not tracked in this session";
    case "malformed_op": return "That log could not be read";
  }
}
