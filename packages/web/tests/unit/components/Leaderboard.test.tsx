import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Leaderboard, type LeaderboardParticipant } from "@/components/Leaderboard";

const participants: LeaderboardParticipant[] = [
  { clerkUserId: "maya", name: "Maya", imageUrl: "" },
  { clerkUserId: "sam", name: "Sam", imageUrl: "" },
  { clerkUserId: "dave", name: "Dave", imageUrl: "" },
];

describe("Leaderboard", () => {
  it("renders participants from most mangoes to fewest while preserving tie order", () => {
    const markup = renderToStaticMarkup(
      <Leaderboard
        itemTypes={[{ key: "mango", emoji: "🥭", label: "Mango" }]}
        participants={participants}
        aggregate={{
          cursor: 4,
          counts: {
            maya: { mango: 1 },
            sam: { mango: 1 },
            dave: { mango: 2 },
          },
        }}
        me="maya"
      />,
    );

    expect(markup.indexOf("Dave")).toBeLessThan(markup.indexOf("Maya"));
    expect(markup.indexOf("Maya")).toBeLessThan(markup.indexOf("Sam"));
  });
});
