export interface Cycle {
  id: string;
  cohortId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  /** The only durable close fact. Status is derived from it. */
  closedAt: Date | null;
  closedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Derived, never stored. See deriveCycleStatus. */
export type CycleStatus = "scheduled" | "live" | "closed";

export interface CycleDetail extends Cycle {
  participantIds: string[];
  itemTypeKeys: string[];
}

export interface CreateCycleInput {
  cohortId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  itemTypeKeys: string[];
  participantIds: string[];
  createdBy: string;
}

export interface UpdateCycleInput {
  name?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
  itemTypeKeys?: string[] | undefined;
  participantIds?: string[] | undefined;
}
