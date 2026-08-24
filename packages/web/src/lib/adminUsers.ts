import { clerkClient } from "@clerk/nextjs/server";
import type { UserRoleStore } from "core";
import { userRoleStore } from "./db";

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
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
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
    avatarUrl: u.imageUrl,
    createdAt: new Date(u.createdAt).toISOString(),
    role: roleByUserId.get(u.id) ?? null,
  }));
}
