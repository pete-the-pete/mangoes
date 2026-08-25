/** Per-cohort role. Deliberately NOT the platform `Role` — the two never mix. */
export type CohortRole = "admin" | "member";

export interface Cohort {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CohortMemberRecord {
  cohortId: string;
  clerkUserId: string;
  role: CohortRole;
  createdAt: Date;
}

/** What a caller wants to do to a member — the two ways to strand a cohort. */
export type CohortMemberChange =
  | { type: "role"; role: CohortRole }
  | { type: "remove" };

/** A cohort where a user is an admin, with that cohort's total admin count. */
export interface CohortAdminMembership {
  cohortId: string;
  cohortName: string;
  adminCount: number;
}
