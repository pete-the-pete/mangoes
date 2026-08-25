import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  itemTypeStore: { listItemTypes: vi.fn(), updateItemType: vi.fn() },
}));

import { requireRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";
import { GET } from "@/app/admin/api/item-types/route";
import { PATCH } from "@/app/admin/api/item-types/[key]/route";

const MANGO = { key: "mango", emoji: "🥭", label: "Mango", enabled: true, position: 0 };

function asRole(role: "owner" | "admin") {
  vi.mocked(requireRole).mockResolvedValue({ ok: true, status: 200, role, clerkUserId: "u1" });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/admin/api/item-types/mango", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const keyParams = { params: Promise.resolve({ key: "mango" }) };

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(itemTypeStore.listItemTypes).mockReset();
  vi.mocked(itemTypeStore.updateItemType).mockReset();
});

describe("GET /admin/api/item-types", () => {
  it("returns the whole catalog to an admin", async () => {
    asRole("admin");
    vi.mocked(itemTypeStore.listItemTypes).mockResolvedValue([MANGO]);
    const res = await GET(new Request("http://localhost/admin/api/item-types"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ itemTypes: [MANGO] });
  });

  it("filters to enabled entries when asked", async () => {
    asRole("admin");
    vi.mocked(itemTypeStore.listItemTypes).mockResolvedValue([MANGO]);
    await GET(new Request("http://localhost/admin/api/item-types?enabled=true"));
    expect(itemTypeStore.listItemTypes).toHaveBeenCalledWith({ enabledOnly: true });
  });
});

describe("PATCH /admin/api/item-types/:key", () => {
  it("lets the owner disable an entry", async () => {
    asRole("owner");
    vi.mocked(itemTypeStore.updateItemType).mockResolvedValue({ ...MANGO, enabled: false });
    const res = await PATCH(patchRequest({ enabled: false }), keyParams);
    expect(res.status).toBe(200);
    expect(itemTypeStore.updateItemType).toHaveBeenCalledWith("mango", { enabled: false });
  });

  // The catalog is platform-wide: one admin's relabel would change every group's
  // sessions, so curation stays with the Super Admin.
  it("refuses a plain admin", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    const res = await PATCH(patchRequest({ enabled: false }), keyParams);
    expect(res.status).toBe(403);
    expect(itemTypeStore.updateItemType).not.toHaveBeenCalled();
  });

  it("rejects a body with nothing to change", async () => {
    asRole("owner");
    const res = await PATCH(patchRequest({}), keyParams);
    expect(res.status).toBe(400);
  });

  it("rejects a blank label", async () => {
    asRole("owner");
    const res = await PATCH(patchRequest({ label: "  " }), keyParams);
    expect(res.status).toBe(400);
  });

  it("404s an unknown key", async () => {
    asRole("owner");
    vi.mocked(itemTypeStore.updateItemType).mockResolvedValue(undefined);
    const res = await PATCH(patchRequest({ enabled: true }), keyParams);
    expect(res.status).toBe(404);
  });
});
