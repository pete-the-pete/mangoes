"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupMemberView, PendingInviteView } from "@/lib/adminGroups";
import { isGmailAddress } from "@/lib/email";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/components/ui/cn";

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
      <h2 className="font-display text-30">Members</h2>

      {error && (
        <Card tone="pink" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p role="alert" className="text-12 text-cream leading-snug">
            {error}
          </p>
        </Card>
      )}
      {notice && (
        <Card tone="turquoise" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p role="alert" className="text-12 text-ink leading-snug">
            {notice}
          </p>
        </Card>
      )}

      <ul className="flex flex-col gap-2.5">
        {initialMembers.map((member) => {
          const isSelf = member.clerkUserId === currentUserId;
          return (
            <li key={member.clerkUserId}>
              <Card
                tone="cream"
                border={4}
                radius={18}
                lift="xs"
                className="flex flex-wrap items-center justify-between gap-3 p-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    src={member.avatarUrl ?? null}
                    name={member.name ?? member.email ?? "?"}
                    size={34}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-display text-19 min-w-0 truncate">
                      {member.name ?? "—"}
                    </span>
                    {/* Body copy: an email in Anton renders uppercase. */}
                    <span className="text-11 text-rust min-w-0 truncate font-medium">
                      {member.email ?? "—"}
                    </span>
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  {canManage ? (
                    <select
                      value={member.role}
                      // The API returns 403 for a caller targeting their own
                      // role, so an enabled control would offer a refused action.
                      disabled={isSelf}
                      title={isSelf ? "You cannot change your own role" : undefined}
                      aria-label={`Group role for ${member.email ?? member.clerkUserId}`}
                      onChange={(e) => changeRole(member.clerkUserId, e.target.value as CohortRole)}
                      className={cn(
                        "font-display border-ink rounded-99 min-h-11 cursor-pointer border-3 border-solid px-3 text-14 uppercase",
                        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink",
                        "disabled:cursor-not-allowed disabled:opacity-100",
                        member.role === "admin" ? "bg-turquoise text-ink" : "bg-cream text-ink",
                      )}
                    >
                      <option value="admin">Group admin</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <Pill tone={member.role === "admin" ? "turquoise" : "cream"}>
                      {ROLE_LABELS[member.role]}
                    </Pill>
                  )}

                  {canManage && (
                    // Left enabled for yourself: leaving a group is allowed,
                    // and the API's 409 is what refuses the last admin.
                    <Button
                      tone="destructive"
                      size="sm"
                      onClick={() => removeMember(member.clerkUserId)}
                      aria-label={`${isSelf ? "Leave this group" : `Remove ${member.email ?? member.clerkUserId}`}`}
                    >
                      {isSelf ? "Leave" : "Remove"}
                    </Button>
                  )}
                </span>
              </Card>
            </li>
          );
        })}
      </ul>

      {initialInvites.length > 0 && (
        <Card tone="cream" border={5} radius={18} lift="xs" className="flex flex-col gap-2 p-3">
          <Label size={10} as="h3" className="text-rust">
            ✉️ {initialInvites.length} {initialInvites.length === 1 ? "invite" : "invites"} pending
          </Label>
          <ul className="flex flex-col gap-1.5">
            {initialInvites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3">
                <span className="text-12 min-w-0 truncate font-medium">{invite.email}</span>
                {canManage && (
                  <Button
                    tone="destructive"
                    size="sm"
                    onClick={() => revokeInvite(invite.id)}
                    aria-label={`Revoke the invitation for ${invite.email}`}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canManage && (
        <form onSubmit={addMember} className="flex flex-wrap items-end gap-3">
          <TextField
            label="Add by email"
            face="plain"
            className="min-w-[14rem] flex-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            placeholder="friend@gmail.com"
          />
          <Button type="submit" disabled={isSubmitting}>
            Add
          </Button>
        </form>
      )}
    </section>
  );
}
