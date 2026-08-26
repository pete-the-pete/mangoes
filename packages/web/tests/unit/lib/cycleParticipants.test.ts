import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CycleDetail } from "core";

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { listCycleParticipants } from "@/lib/cycleParticipants";

const clerkMock = { users: { getUserList: vi.fn() } };

beforeEach(() => {
  clerkMock.users.getUserList.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

function cycle(participantIds: string[]): CycleDetail {
  return { participantIds } as CycleDetail;
}

describe("listCycleParticipants", () => {
  it("shows a named participant's name, never their email", async () => {
    clerkMock.users.getUserList.mockResolvedValue({
      data: [
        {
          id: "u1",
          firstName: "Dave",
          lastName: null,
          imageUrl: "https://img/1",
          primaryEmailAddress: { emailAddress: "dave@gmail.com" },
        },
      ],
    });

    const rows = await listCycleParticipants(cycle(["u1"]));
    expect(rows).toEqual([{ clerkUserId: "u1", name: "Dave", imageUrl: "https://img/1" }]);
  });

  it("falls back to the generic label — not email, not the Clerk id — when unnamed", async () => {
    clerkMock.users.getUserList.mockResolvedValue({
      data: [
        {
          id: "u2",
          firstName: null,
          lastName: null,
          imageUrl: "https://img/2",
          primaryEmailAddress: { emailAddress: "u2@gmail.com" },
        },
      ],
    });

    const rows = await listCycleParticipants(cycle(["u2"]));
    expect(rows).toEqual([{ clerkUserId: "u2", name: "Unnamed member", imageUrl: "https://img/2" }]);
  });

  it("returns an empty list without calling Clerk when there are no participants", async () => {
    const rows = await listCycleParticipants(cycle([]));
    expect(rows).toEqual([]);
    expect(clerkMock.users.getUserList).not.toHaveBeenCalled();
  });
});
