import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn() }));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { PATCH } from "@/app/api/me/route";

const clerkMock = { users: { updateUser: vi.fn() } };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  clerkMock.users.updateUser.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

function signedIn(userId = "u1") {
  vi.mocked(auth).mockResolvedValue({ userId } as never);
}

describe("PATCH /api/me", () => {
  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await PATCH(makeRequest({ firstName: "Ada" }));
    expect(res.status).toBe(401);
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("saves the caller's own name", async () => {
    signedIn();
    clerkMock.users.updateUser.mockResolvedValue({});

    const res = await PATCH(
      makeRequest({ firstName: "  Ada  ", lastName: "Lovelace" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u1", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  // The session's user id is the only one this route will ever write to. A
  // body carrying someone else's id must not redirect the update.
  it("ignores a user id in the body", async () => {
    signedIn("u1");
    clerkMock.users.updateUser.mockResolvedValue({});

    await PATCH(makeRequest({ userId: "u2", id: "u2", firstName: "Ada" }));

    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u1", {
      firstName: "Ada",
      lastName: "",
    });
  });

  // Blank is a legitimate choice: peers then see UNNAMED_MEMBER, which is
  // exactly the state a user is entitled to return to.
  it("lets a user clear their name", async () => {
    signedIn();
    clerkMock.users.updateUser.mockResolvedValue({});

    const res = await PATCH(makeRequest({ firstName: "", lastName: "" }));

    expect(res.status).toBe(200);
    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u1", {
      firstName: "",
      lastName: "",
    });
  });

  it("rejects an over-long name", async () => {
    signedIn();
    const res = await PATCH(makeRequest({ firstName: "x".repeat(65) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "First name must be 64 characters or less",
    });
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a non-string name", async () => {
    signedIn();
    const res = await PATCH(makeRequest({ lastName: [] }));
    expect(res.status).toBe(400);
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    signedIn();
    const res = await PATCH(
      new Request("http://localhost/api/me", { method: "PATCH", body: "not json" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("returns 502 when Clerk's update throws", async () => {
    signedIn();
    clerkMock.users.updateUser.mockRejectedValue(new Error("clerk down"));
    const res = await PATCH(makeRequest({ firstName: "Ada" }));
    expect(res.status).toBe(502);
  });
});
