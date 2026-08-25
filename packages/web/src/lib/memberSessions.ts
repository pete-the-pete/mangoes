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
