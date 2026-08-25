"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupMemberView, PendingInviteView } from "@/lib/adminGroups";
import { isGmailAddress } from "@/lib/email";

type CohortRole = GroupMemberView["role"];

const ROLE_LABELS: Record<CohortRole, string> = {
  admin: "Group admin",
  member: "Member",
};

export function MembersPanel({
  groupId,
  initialMembers,
  initialInvites,
  canManage,
  currentUserId,
}: {
  groupId: string;
  initialMembers: GroupMemberView[];
  initialInvites: PendingInviteView[];
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  // Every mutation ends in router.refresh(): the server component owns this
  // data, so returning to server truth beats guessing a rollback.
  async function mutate(
    url: string,
    init: RequestInit,
    fallbackError: string,
  ): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    setError(null);
    setNotice(null);
    const res = await fetch(url, init);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      setError((body["error"] as string) ?? fallbackError);
    }
    router.refresh();
    return { ok: res.ok, body };
  }

  async function changeRole(clerkUserId: string, role: CohortRole) {
    await mutate(
      `/admin/api/groups/${groupId}/members/${clerkUserId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      },
      "Could not change the role",
    );
  }

  async function removeMember(clerkUserId: string) {
    await mutate(
      `/admin/api/groups/${groupId}/members/${clerkUserId}`,
      { method: "DELETE" },
      "Could not remove that member",
    );
  }

  async function revokeInvite(invitationId: string) {
    await mutate(
      `/admin/api/groups/${groupId}/invites/${invitationId}`,
      { method: "DELETE" },
      "Could not revoke that invitation",
    );
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    // Same rule the route enforces — checked here so an obvious typo never
    // reaches Clerk.
    if (!isGmailAddress(trimmed)) {
      setNotice(null);
      setError("Email must be a @gmail.com address");
      return;
    }

    setSubmitting(true);
    try {
      const { ok, body } = await mutate(
        `/admin/api/groups/${groupId}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        },
        "Could not add that person",
      );
      if (ok) {
        setEmail("");
        setNotice(
          body["added"]
            ? `${trimmed} was added to the group.`
            : `Invitation sent to ${trimmed}.`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Members</h2>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="alert" className="text-sm text-teal-700">
          {notice}
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-gray-500">
            <th className="py-2 font-medium">Name</th>
            <th className="font-medium">Email</th>
            <th className="font-medium">Role</th>
            {canManage && <th className="font-medium" />}
          </tr>
        </thead>
        <tbody>
          {initialMembers.map((member) => {
            const isSelf = member.clerkUserId === currentUserId;
            return (
              <tr key={member.clerkUserId} className="border-b">
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={member.avatarUrl ?? undefined}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-full bg-gray-100"
                    />
                    {member.name ?? "—"}
                  </span>
                </td>
                <td>{member.email ?? "—"}</td>
                <td>
                  {canManage ? (
                    <select
                      value={member.role}
                      // The API returns 403 for a caller targeting their own
                      // role, so an enabled control would offer a refused action.
                      disabled={isSelf}
                      title={isSelf ? "You cannot change your own role" : undefined}
                      aria-label={`Group role for ${member.email ?? member.clerkUserId}`}
                      onChange={(e) =>
                        changeRole(member.clerkUserId, e.target.value as CohortRole)
                      }
                      className="rounded border px-2 py-1 disabled:opacity-50"
                    >
                      <option value="admin">Group admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span className="rounded-full border px-2 py-0.5 text-xs">
                      {ROLE_LABELS[member.role]}
                    </span>
                  )}
                </td>
                {canManage && (
                  <td className="text-right">
                    {/* Left enabled for yourself: leaving a group is allowed,
                        and the API's 409 is what refuses the last admin. */}
                    <button
                      type="button"
                      onClick={() => removeMember(member.clerkUserId)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      {isSelf ? "Leave" : "Remove"}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {initialInvites.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-gray-500">Pending invitations</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {initialInvites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between border-b py-1">
                <span>{invite.email}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => revokeInvite(invite.id)}
                    className="text-red-600 hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <form onSubmit={addMember} className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Add by email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              placeholder="friend@gmail.com"
              className="rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}
    </section>
  );
}
