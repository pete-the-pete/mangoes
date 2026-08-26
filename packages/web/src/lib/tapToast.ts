/** The subset of `OutboxOp` (`@/lib/sync/store`) this decision needs. */
export interface TapToastOp {
  clientEntryId: string;
  kind: "log" | "void";
  itemTypeKey?: string | undefined;
}

export interface TapToastBookkeeping {
  /** clientEntryIds present in `state.pending` as of the last decision. */
  prevPendingIds: Set<string>;
  /**
   * clientEntryIds that have ever been shown a toast. Permanent for the
   * component's lifetime — an id in here is never toasted again, even if it
   * later re-appears in `pending` (see `pickTapToast`'s doc comment for why
   * that happens).
   */
  toastedIds: Set<string>;
  /** Taps made by this screen that haven't yet been matched to a toast. */
  pendingTapCredits: number;
}

export function initialTapToastBookkeeping(): TapToastBookkeeping {
  return { prevPendingIds: new Set(), toastedIds: new Set(), pendingTapCredits: 0 };
}

export interface TapToastDecision {
  /** The op to show an undo toast for, if any. */
  toast: { clientEntryId: string; itemTypeKey: string } | undefined;
  nextBookkeeping: TapToastBookkeeping;
}

/**
 * Pure decision function behind the live session screen's undo toast.
 * `log()` doesn't hand back the clientEntryId it creates, so the only way to
 * know which pending op a tap just produced is to diff `state.pending`
 * across renders — but a naive "wasn't in the previous snapshot" check is
 * unsound on its own, for two independent reasons this function guards
 * against:
 *
 * 1. **Re-appearance of an already-toasted op (the correctness bug this
 *    replaced a diff-only implementation over).** `state.pending` can SHRINK
 *    from a cause other than this device's own flush settling: the SSE
 *    stream's `dropConfirmed` removes an op from `pending` the moment the
 *    stream sees it land server-side, which can happen before this device's
 *    own `settleFlush` (the response to ITS OWN POST) has durably removed
 *    the row from the IndexedDB outbox. A later, unrelated `log()`/`undo()`
 *    call re-reads the full outbox via `refreshPending()`, and that
 *    still-not-yet-settled row reappears in `pending` — looking, to a
 *    same-render diff, exactly like a brand new tap. Without a permanent
 *    `toastedIds` record, that reappearance raises a second toast for a tap
 *    the member already dismissed/kept, and accepting its Undo queues a
 *    real void the member never asked for. `toastedIds` makes toasting
 *    strictly one-shot per clientEntryId, independent of how many times the
 *    id transiently drops out of and back into `pending`.
 * 2. **A restored offline queue on mount looking like a batch of fresh
 *    taps.** `pendingTapCredits` gates on "how many taps has this component
 *    actually made that aren't yet accounted for" — incremented by the
 *    caller in the tap handler, spent here. Mounting with a pre-existing
 *    offline queue (from a past visit to this session) produces "new" ids on
 *    the very first call with zero credits available, so nothing is toasted.
 *
 * When multiple new ops appear in the same call (a rapid double-tap can
 * queue two before a render lands), every one of them consumes a credit —
 * not just one regardless of count — even though only the most recent is
 * actually shown a toast. Under-spending credits here is exactly the bug
 * class this guards against: leftover credit is what lets a later,
 * unrelated reappearance (case 1) slip past the credit check.
 */
export function pickTapToast(pending: TapToastOp[], bookkeeping: TapToastBookkeeping): TapToastDecision {
  const currentIds = new Set(pending.map((op) => op.clientEntryId));

  const newlyAppeared: { clientEntryId: string; itemTypeKey: string }[] = [];
  for (const op of pending) {
    if (
      op.kind === "log" &&
      op.itemTypeKey &&
      !bookkeeping.prevPendingIds.has(op.clientEntryId) &&
      !bookkeeping.toastedIds.has(op.clientEntryId)
    ) {
      newlyAppeared.push({ clientEntryId: op.clientEntryId, itemTypeKey: op.itemTypeKey });
    }
  }

  let pendingTapCredits = bookkeeping.pendingTapCredits;
  const toastedIds = new Set(bookkeeping.toastedIds);
  let toast: TapToastDecision["toast"];

  if (newlyAppeared.length > 0 && pendingTapCredits > 0) {
    const spend = Math.min(newlyAppeared.length, pendingTapCredits);
    pendingTapCredits -= spend;
    for (const op of newlyAppeared) toastedIds.add(op.clientEntryId);
    // Track the most recent tap, not the first one seen — a double-tap's
    // toast should reflect the latest of the batch.
    toast = newlyAppeared[newlyAppeared.length - 1];
  }

  return {
    toast,
    nextBookkeeping: { prevPendingIds: currentIds, toastedIds, pendingTapCredits },
  };
}
