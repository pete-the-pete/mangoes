import { describe, it, expect } from "vitest";
import { initialTapToastBookkeeping, pickTapToast, type TapToastOp } from "@/lib/tapToast";

function log(clientEntryId: string, itemTypeKey = "mango"): TapToastOp {
  return { clientEntryId, kind: "log", itemTypeKey };
}

describe("pickTapToast", () => {
  it("does not toast a restored offline queue on mount (no credit spent)", () => {
    const restored = [log("a"), log("b")];
    const { toast, nextBookkeeping } = pickTapToast(restored, initialTapToastBookkeeping());
    expect(toast).toBeUndefined();
    expect(nextBookkeeping.pendingTapCredits).toBe(0);
    expect(nextBookkeeping.prevPendingIds).toEqual(new Set(["a", "b"]));
  });

  it("toasts a tap once a credit is available", () => {
    const before = { ...initialTapToastBookkeeping(), pendingTapCredits: 1 };
    const { toast, nextBookkeeping } = pickTapToast([log("a")], before);
    expect(toast).toEqual({ clientEntryId: "a", itemTypeKey: "mango" });
    expect(nextBookkeeping.pendingTapCredits).toBe(0);
    expect(nextBookkeeping.toastedIds.has("a")).toBe(true);
  });

  it("never re-toasts the same clientEntryId, even after it drops out and reappears", () => {
    const withCredit = { ...initialTapToastBookkeeping(), pendingTapCredits: 1 };
    const first = pickTapToast([log("a")], withCredit);
    expect(first.toast?.clientEntryId).toBe("a");

    // The SSE stream confirms "a" and dropConfirmed removes it from pending
    // before this device's own settleFlush ran.
    const afterConfirm = pickTapToast([], first.nextBookkeeping);
    expect(afterConfirm.toast).toBeUndefined();

    // An unrelated log()/undo() call re-reads the durable outbox, which
    // still (transiently) holds "a" — it must not look like a fresh tap.
    const reappeared = pickTapToast([log("a")], afterConfirm.nextBookkeeping);
    expect(reappeared.toast).toBeUndefined();
    expect(reappeared.nextBookkeeping.toastedIds.has("a")).toBe(true);
  });

  it("spends one credit per newly-appeared op even when only the latest is shown", () => {
    // Two credits (two taps), but only one credit's worth of matching should
    // remain after a single render surfaces both new ops at once.
    const before = { ...initialTapToastBookkeeping(), pendingTapCredits: 2 };
    const { toast, nextBookkeeping } = pickTapToast([log("a"), log("b")], before);
    // Only the most recent (last in the list) is actually shown...
    expect(toast?.clientEntryId).toBe("b");
    // ...but BOTH consumed a credit and are marked toasted, so neither can
    // pop a second toast on a later reappearance.
    expect(nextBookkeeping.pendingTapCredits).toBe(0);
    expect(nextBookkeeping.toastedIds.has("a")).toBe(true);
    expect(nextBookkeeping.toastedIds.has("b")).toBe(true);
  });

  it("caps spend at the available credit when more ops appear than credits", () => {
    const before = { ...initialTapToastBookkeeping(), pendingTapCredits: 1 };
    const { nextBookkeeping } = pickTapToast([log("a"), log("b")], before);
    expect(nextBookkeeping.pendingTapCredits).toBe(0);
  });

  it("ignores void ops and ops with no itemTypeKey", () => {
    const before = { ...initialTapToastBookkeeping(), pendingTapCredits: 1 };
    const voidOp: TapToastOp = { clientEntryId: "v", kind: "void" };
    const { toast, nextBookkeeping } = pickTapToast([voidOp], before);
    expect(toast).toBeUndefined();
    expect(nextBookkeeping.pendingTapCredits).toBe(1);
  });
});
