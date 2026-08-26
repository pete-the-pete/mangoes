import { deriveCycleStatus, isCycleOverdue, type CycleDetail, type CycleStatus } from "core";

export interface MemberSessionJson {
  id: string;
  groupId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: CycleStatus;
  isOverdue: boolean;
  itemTypeKeys: string[];
  participantIds: string[];
}

export function toMemberSessionJson(cycle: CycleDetail, now: Date = new Date()): MemberSessionJson {
  return {
    id: cycle.id,
    groupId: cycle.cohortId,
    name: cycle.name,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    status: deriveCycleStatus(cycle, now),
    isOverdue: isCycleOverdue(cycle, now),
    itemTypeKeys: cycle.itemTypeKeys,
    participantIds: cycle.participantIds,
  };
}

export interface SplitByStatusResult {
  live: MemberSessionJson[];
  scheduled: MemberSessionJson[];
  recent: MemberSessionJson[];
}

export function splitByStatus(cycles: CycleDetail[], now: Date = new Date()): SplitByStatusResult {
  const live: MemberSessionJson[] = [];
  const scheduled: MemberSessionJson[] = [];
  const recent: MemberSessionJson[] = [];
  for (const cycle of cycles) {
    const json = toMemberSessionJson(cycle, now);
    if (json.status === "live") live.push(json);
    else if (json.status === "scheduled") scheduled.push(json);
    else recent.push(json);
  }
  return { live, scheduled, recent };
}

const WINDOW_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** UTC, deliberately: a session window is shared, and formatting on the
 *  server in the viewer's local zone would also be a hydration mismatch
 *  waiting to happen the moment this is reused from a client component. */
export function formatSessionWindow(startsAt: Date, endsAt: Date): string {
  return `${WINDOW_FMT.format(startsAt)} – ${WINDOW_FMT.format(endsAt)}`;
}

/**
 * A session view model for the chooser / browsable list / group roster —
 * distinct from `MemberSessionJson` (the wire shape `/api/sessions` and
 * `/api/current-session` already return) because those screens need a
 * formatted window and the session's item emoji, not raw keys and ISO dates.
 */
export interface SessionListItem {
  id: string;
  name: string;
  status: CycleStatus;
  isOverdue: boolean;
  window: string;
  itemEmoji: string[];
}

export function toSessionListItem(
  cycle: CycleDetail,
  emojiByKey: Map<string, string>,
  now: Date = new Date(),
): SessionListItem {
  return {
    id: cycle.id,
    name: cycle.name,
    status: deriveCycleStatus(cycle, now),
    isOverdue: isCycleOverdue(cycle, now),
    window: formatSessionWindow(cycle.startsAt, cycle.endsAt),
    itemEmoji: cycle.itemTypeKeys.map((key) => emojiByKey.get(key) ?? "•"),
  };
}

export interface SplitSessionListResult {
  live: SessionListItem[];
  scheduled: SessionListItem[];
  recent: SessionListItem[];
}

/** Same three groupings as `splitByStatus`, over the display view model. */
export function splitSessionListItems(
  cycles: CycleDetail[],
  emojiByKey: Map<string, string>,
  now: Date = new Date(),
): SplitSessionListResult {
  const live: SessionListItem[] = [];
  const scheduled: SessionListItem[] = [];
  const recent: SessionListItem[] = [];
  for (const cycle of cycles) {
    const item = toSessionListItem(cycle, emojiByKey, now);
    if (item.status === "live") live.push(item);
    else if (item.status === "scheduled") scheduled.push(item);
    else recent.push(item);
  }
  return { live, scheduled, recent };
}

export interface GroupSessionParticipation {
  /** Ids of the group's sessions this member actually takes part in. */
  participatingIds: Set<string>;
  /** How many of the group's sessions they are not in. */
  excludedCount: number;
}

/**
 * Splits a group's sessions into the ones the viewer is in and the ones they
 * aren't.
 *
 * The member group page lists every session in the *group*, but
 * `/sessions/[id]` is gated on being in that session's `cycle_participants` —
 * two different lists. Linking all of them sent members who weren't in the
 * crew to a 404 that read as a broken app rather than as "you're not in this
 * one," which is the state a member lands in whenever they join a group after
 * a session was already created.
 */
export function splitGroupSessionsByParticipation(
  cycles: CycleDetail[],
  clerkUserId: string,
): GroupSessionParticipation {
  const participatingIds = new Set(
    cycles.filter((c) => c.participantIds.includes(clerkUserId)).map((c) => c.id),
  );
  return { participatingIds, excludedCount: cycles.length - participatingIds.size };
}
