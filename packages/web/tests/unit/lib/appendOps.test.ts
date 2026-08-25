import { describe, it, expect } from "vitest";
import { parseAppendOps, rejectionMessage } from "@/lib/appendOps";

const uuid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("parseAppendOps", () => {
  it("accepts a log op", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: uuid, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a void op referencing a client id", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: uuid, kind: "void", voidsClientEntryId: other, occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a log with no item type", () => {
    const result = parseAppendOps({ ops: [{ clientEntryId: uuid, kind: "log", occurredAt: "2026-09-01T00:00:00.000Z" }] });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a non-uuid client entry id", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: "nope", kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects an empty batch and one over the cap", () => {
    expect(parseAppendOps({ ops: [] })).toMatchObject({ ok: false });
    const many = Array.from({ length: 501 }, () => ({
      clientEntryId: uuid, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z",
    }));
    expect(parseAppendOps({ ops: many })).toMatchObject({ ok: false });
  });

  it("never lets a member set subjectUserId", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: uuid, kind: "log", itemTypeKey: "mango", subjectUserId: "someone-else", occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("rejectionMessage", () => {
  it("translates the core reason into session vocabulary", () => {
    expect(rejectionMessage("cycle_closed")).toBe("Only a session admin can amend a closed session");
  });
});
