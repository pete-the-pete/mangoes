import { clerkClient } from "@clerk/nextjs/server";
import type { UserRoleStore } from "core";
import { userRoleStore } from "./db";
import { joinName } from "./userName";

export interface AdminUserRow {
  id: string;
  email: string | null;
  /** The joined display name, or null when the user has neither half. */
  name: string | null;
  /**
   * Both halves kept separate as well, so the roster's inline edit can seed
   * its fields without having to guess where to split `name`.
   */
  firstName: string;
  lastName: string;
  avatarUrl: string;
  createdAt: string;
  role: "owner" | "admin" | "member" | null;
}

export async function listUsersForAdmin(
  store: UserRoleStore = userRoleStore,
): Promise<AdminUserRow[]> {
  const clerk = await clerkClient();
  const { data: clerkUsers } = await clerk.users.getUserList({ limit: 100 });
  const roles = await store.listRoles();
  const roleByUserId = new Map(roles.map((r) => [r.clerkUserId, r.role]));

  return clerkUsers.map((u) => ({
    id: u.id,
    email: u.primaryEmailAddress?.emailAddress ?? null,
    name: joinName(u.firstName, u.lastName),
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    avatarUrl: u.imageUrl,
    createdAt: new Date(u.createdAt).toISOString(),
    role: roleByUserId.get(u.id) ?? null,
  }));
}
