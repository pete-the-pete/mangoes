import { describe, it, expect } from "vitest";
import { parseCreateSession, parseUpdateSession } from "@/lib/sessions";

const ctx = {
  memberIds: ["u1", "u2"],
  enabledKeys: ["mango", "taco"],
};

const VALID = {
  name: "Beach day",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-08T00:00:00.000Z",
  itemTypeKeys: ["mango"],
  participantIds: ["u1"],
};

describe("parseCreateSession", () => {
  it("accepts a valid payload", () => {
    const result = parseCreateSession(VALID, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Beach day");
      expect(result.value.participantIds).toEqual(["u1"]);
    }
  });

  it("defaults participants to the whole group when omitted", () => {
    const { participantIds: _omitted, ...rest } = VALID;
    const result = parseCreateSession(rest, ctx);
    expect(result.ok && result.value.participantIds).toEqual(["u1", "u2"]);
  });

  // An explicit [] is a mistake, not a request for an empty session: nobody can
  // log against it. Vacuous "every entry is a member" would have passed it.
  it("rejects an explicitly empty participant list", () => {
    const result = parseCreateSession({ ...VALID, participantIds: [] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a participant who is not in the group", () => {
    const result = parseCreateSession({ ...VALID, participantIds: ["stranger"] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty item type list", () => {
    const result = parseCreateSession({ ...VALID, itemTypeKeys: [] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects an item type that is unknown or disabled", () => {
    const result = parseCreateSession({ ...VALID, itemTypeKeys: ["margarita"] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a window that ends before it starts", () => {
    const result = parseCreateSession(
      { ...VALID, startsAt: VALID.endsAt, endsAt: VALID.startsAt },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unparseable date", () => {
    const result = parseCreateSession({ ...VALID, startsAt: "whenever" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a blank name", () => {
    const result = parseCreateSession({ ...VALID, name: "  " }, ctx);
    expect(result.ok).toBe(false);
  });

  it("reports when the catalog has nothing enabled", () => {
    const result = parseCreateSession(VALID, { ...ctx, enabledKeys: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no item types/i);
    }
  });
});

describe("parseUpdateSession", () => {
  const current = {
    startsAt: new Date(VALID.startsAt),
    endsAt: new Date(VALID.endsAt),
  };

  it("accepts a partial payload", () => {
    const result = parseUpdateSession({ name: "Renamed" }, ctx, current);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Renamed");
      expect(result.value.startsAt).toBeUndefined();
    }
  });

  // The merged window is what matters: moving only the end date can still
  // invert a window that was valid before.
  it("checks a new end date against the stored start date", () => {
    const result = parseUpdateSession(
      { endsAt: "2026-08-01T00:00:00.000Z" },
      ctx,
      current,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an empty participant list on update too", () => {
    const result = parseUpdateSession({ participantIds: [] }, ctx, current);
    expect(result.ok).toBe(false);
  });

  it("accepts an empty object as a no-op", () => {
    expect(parseUpdateSession({}, ctx, current).ok).toBe(true);
  });
});
