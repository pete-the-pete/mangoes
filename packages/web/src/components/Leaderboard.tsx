import { groupTotal, subjectTotal, type Aggregate } from "core";
import { Avatar } from "./ui/Avatar";
import { Card } from "./ui/Card";
import { Stagger } from "./ui/Stagger";
import { Label } from "./ui/Label";
import { Pill } from "./ui/Pill";
import { cn } from "./ui/cn";

export interface LeaderboardItemType {
  key: string;
  emoji: string;
  label: string;
}

export interface LeaderboardParticipant {
  clerkUserId: string;
  name: string;
  imageUrl: string;
}

export interface LeaderboardProps {
  itemTypes: LeaderboardItemType[];
  participants: LeaderboardParticipant[];
  aggregate: Aggregate;
  me: string;
}

/**
 * Per-person, per-item counts plus a group total per item — this is the
 * spec's answer to "is the roster visible to every participant": a
 * leaderboard IS a roster, so there is no separate member-facing member
 * list anywhere. Reads `groupTotal`/`subjectTotal` from core rather than
 * summing counts by hand, per the milestone's constraint.
 *
 * The handoff draws screen 2 as a ranked list of single counts with a bar per
 * person. That shape assumes one item type; a session can track several, and
 * "rank" is undefined across them. So this keeps the matrix and borrows the
 * row treatment: outlined cards, Anton counts, the current user's row raised
 * off the page.
 */
export function Leaderboard({ itemTypes, participants, aggregate, me }: LeaderboardProps) {
  if (itemTypes.length === 0 || participants.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2.5">
      <Label size={12} className="text-rust">
        The leaderboard
      </Label>

      {/* No `layout` animation on these rows, deliberately: the leaderboard is
          unranked by design (docs/design/README.md rejects a ranked one), so
          rows never reorder and there is no position change to animate. */}
      <Stagger className="flex flex-col gap-2.5">
      {participants.map((p) => {
        const isMe = p.clerkUserId === me;
        return (
          <Card
            key={p.clerkUserId}
            tone="cream"
            border={4}
            radius={18}
            lift={isMe ? "lg" : "xs"}
            className={cn(
              "flex items-center justify-between gap-3 p-2.5",
              // The handoff gives the current user's row full opacity and a
              // deeper shadow while everyone else's sits back.
              !isMe && "opacity-85",
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar src={p.imageUrl || null} name={p.name} size={36} />
              {/* The name goes through Anton, which uppercases. The "you"
                  marker is a separate badge rather than part of that string —
                  folded in, it would read as DAVE (YOU). */}
              <span className="font-display text-19 min-w-0 truncate">{p.name}</span>
              {isMe && (
                <Pill tone="turquoise" className="shrink-0">
                  You
                </Pill>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              {itemTypes.map((t) => (
                <span key={t.key} className="flex items-center gap-1" title={t.label}>
                  <span aria-hidden="true" className="text-14">
                    {t.emoji}
                  </span>
                  <span className="font-display text-24 leading-none tabular-nums">
                    {subjectTotal(aggregate, p.clerkUserId, t.key)}
                  </span>
                  <span className="sr-only">{t.label}</span>
                </span>
              ))}
            </span>
          </Card>
        );
      })}

      <Card tone="ink" border={4} radius={18} lift="xs" className="flex items-center justify-between gap-3 p-3">
        <Label size={11} className="text-mango-yellow">
          Group total
        </Label>
        <span className="flex shrink-0 items-center gap-3">
          {itemTypes.map((t) => (
            <span key={t.key} className="flex items-center gap-1" title={t.label}>
              <span aria-hidden="true" className="text-14">
                {t.emoji}
              </span>
              <span className="font-display text-mango-yellow text-26 leading-none tabular-nums">
                {groupTotal(aggregate, t.key)}
              </span>
              <span className="sr-only">{t.label}</span>
            </span>
          ))}
        </span>
      </Card>
      </Stagger>

      {/* groupTotal folds in entries logged for the group as a whole (an
          admin-only action with no member-facing surface), so Total can run
          higher than the rows above it add up to — spelled out here so that
          reads as expected, not as a bug. Body copy, not a Label: it is prose
          meant to be read, and Label is uppercase and tracked. */}
      <p className="text-12 text-rust leading-snug">
        Group total also counts entries logged for the group, not credited to any one person.
      </p>
    </section>
  );
}
