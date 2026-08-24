"use client";

import { useState } from "react";
import type { AdminUserRow } from "@/lib/adminUsers";
import { InviteUserModal } from "./InviteUserModal";

// `joined` is precomputed by the server component — see the note on JOINED_FMT
// in page.tsx for why it isn't formatted here.
export type AdminUserView = AdminUserRow & { joined: string };

type Role = NonNullable<AdminUserRow["role"]>;

// core speaks in generic roles; the "Super Admin"/"Admin"/"Member" wording is a
// web-layer display concern and lives only here (root CLAUDE.md, boundary rule).
const ROLE_LABELS: Record<Role, string> = {
  owner: "Super Admin",
  admin: "Admin",
  member: "Member",
};

function roleLabel(role: Role | null): string {
  // No user_roles row yet: invited but never signed in, so role resolution
  // hasn't run for them. Say "Pending" rather than guess a role.
  return role ? ROLE_LABELS[role] : "Pending";
}

export function AdminUserTable({
  initialUsers,
  canManage,
  currentUserId,
}: {
  initialUsers: AdminUserView[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleRoleChange(userId: string, newRole: Role) {
    const previousRole = users.find((u) => u.id === userId)?.role ?? null;
    setUsers((rows) =>
      rows.map((r) => (r.id === userId ? { ...r, role: newRole } : r)),
    );
    setError(null);
    setNotice(null);

    const res = await fetch(`/admin/api/users/${userId}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });

    if (!res.ok) {
      // Revert only this row. Restoring a snapshot of the whole array would
      // clobber any other change that landed while this request was in flight.
      setUsers((rows) =>
        rows.map((r) => (r.id === userId ? { ...r, role: previousRole } : r)),
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to update role");
    }
  }

  return (
    <div>
      {canManage && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="mb-4 rounded bg-teal-600 px-3 py-2 text-sm font-medium text-white"
        >
          Invite user
        </button>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="alert" className="mb-3 text-sm text-teal-700">
          {notice}
        </p>
      )}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 font-medium">Name</th>
            <th className="font-medium">Email</th>
            <th className="font-medium">Role</th>
            <th className="font-medium">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="border-b">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    {/* A 32px avatar off Clerk's CDN isn't worth adding an
                        images.remotePatterns allowlist for next/image. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u.avatarUrl}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-full bg-gray-100"
                    />
                    {u.name ?? "—"}
                  </span>
                </td>
                <td>{u.email ?? "—"}</td>
                <td>
                  {canManage ? (
                    <select
                      value={u.role ?? ""}
                      // The PATCH route returns 403 for a caller targeting
                      // themselves, so an enabled control here would offer an
                      // action the API always refuses.
                      disabled={isSelf}
                      title={
                        isSelf ? "You cannot change your own role" : undefined
                      }
                      aria-label={`Role for ${u.email ?? u.id}`}
                      onChange={(e) =>
                        handleRoleChange(u.id, e.target.value as Role)
                      }
                      className="rounded border px-2 py-1 disabled:opacity-50"
                    >
                      <option value="" disabled>
                        Pending
                      </option>
                      <option value="owner">Super Admin</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span className="rounded-full border px-2 py-0.5 text-xs">
                      {roleLabel(u.role)}
                    </span>
                  )}
                </td>
                <td>{u.joined}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {inviteOpen && (
        <InviteUserModal
          onClose={() => setInviteOpen(false)}
          onInvited={(email) => {
            setInviteOpen(false);
            setError(null);
            // Deliberately no refresh: an invited user doesn't appear in
            // Clerk's user list until they accept, so there is nothing new to
            // fetch yet.
            setNotice(`Invitation sent to ${email}.`);
          }}
        />
      )}
    </div>
  );
}
