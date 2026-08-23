export type Role = "owner" | "admin" | "member";

export interface UserRoleRecord {
  clerkUserId: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}
