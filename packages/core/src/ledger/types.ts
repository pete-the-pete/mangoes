/** Sentinel subject key for untagged entries — credited to the group, to no individual. */
export const UNTAGGED = "__untagged__";

/** A user id, or UNTAGGED. */
export type SubjectKey = string;

export type LedgerEntryKind = "log" | "void";

export interface LedgerEntry {
  id: string;
  cycleId: string;
  seq: number;
  kind: LedgerEntryKind;
  itemTypeKey: string;
  /** null = untagged. */
  subjectUserId: string | null;
  actorUserId: string;
  voidsEntryId: string | null;
  clientEntryId: string;
  occurredAt: Date;
  createdAt: Date;
}

export interface AppendOp {
  /** Client-generated UUID. The idempotency key. */
  clientEntryId: string;
  kind: LedgerEntryKind;
  /** Required for kind "log". Ignored for "void" — copied from the target. */
  itemTypeKey?: string | undefined;
  /** Required for kind "void". Resolves the target by client id, never server id. */
  voidsClientEntryId?: string | undefined;
  /**
   * For kind "log": omit to credit the actor, or pass null explicitly for untagged.
   * Ignored for "void".
   */
  subjectUserId?: string | null | undefined;
  occurredAt: Date;
}

/**
 * What the caller is allowed to do. The store enforces these because it already
 * holds the target row inside the transaction — pushing the checks up to the
 * caller would cost a round trip per void.
 */
export interface AppendContext {
  actorUserId: string;
  /** False for members: voiding an entry with a different subject is rejected. */
  canVoidOthers: boolean;
  /** False for members: any append to a closed cycle is rejected. */
  canWriteClosed: boolean;
  /** False for members: an explicit subject other than the actor is rejected. */
  canWriteForOthers: boolean;
}

export type RejectReason =
  | "cycle_closed"
  | "unknown_target"
  | "not_your_entry"
  | "already_voided"
  | "unknown_item_type"
  | "malformed_op";

export interface AppendRejection {
  clientEntryId: string;
  reason: RejectReason;
}

export interface AppendResult {
  /** The cycle's sequence after this append. */
  cursor: number;
  accepted: string[];
  /** Already present. A normal outcome of a retried flush, never an error. */
  duplicates: string[];
  rejected: AppendRejection[];
}

export interface Aggregate {
  cursor: number;
  /** counts[subjectKey][itemTypeKey] */
  counts: Record<SubjectKey, Record<string, number>>;
}

export interface DeltaPage {
  entries: LedgerEntry[];
  nextCursor: number;
  hasMore: boolean;
}
