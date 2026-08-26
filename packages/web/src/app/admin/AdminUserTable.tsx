"use client";

import { useState } from "react";
import type { AdminUserRow } from "@/lib/adminUsers";
import { InviteUserModal } from "./InviteUserModal";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { PageShell } from "@/components/ui/PageShell";
import { StatTile } from "@/components/ui/StatTile";
import { cn } from "@/components/ui/cn";
import { MAX_NAME_LENGTH, joinName } from "@/lib/userName";

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

/**
 * Screen 8's role-badge fills. The design has a fourth badge, INVITED, for
 * someone who has been invited but never signed in — which is exactly this
 * codebase's `role: null`. The fill is the design's; the wording stays
 * "Pending", which is what the rest of the app already calls that state.
 */
const ROLE_FILL: Record<Role | "pending", string> = {
  owner: "bg-mango-yellow text-ink",
  admin: "bg-turquoise text-ink",
  member: "bg-cream text-ink",
  pending: "bg-mango-orange text-ink",
};

/**
 * The roster's inline name inputs. Bare <input>s rather than TextField for the
 * same reason the role control below is a bare <select>: TextField stacks a
 * label above its control, which would double the height of every row in the
 * list. The accessible name comes from aria-label instead.
 */
const NAME_INPUT =
  "font-sans text-14 text-ink bg-white border-ink rounded-16 min-h-11 w-full min-w-[7rem] flex-1 border-3 border-solid px-2.5 py-1 outline-none " +
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink";

function roleLabel(role: Role | null): string {
  // No user_roles row yet: invited but never signed in, so role resolution
  // hasn't run for them. Say "Pending" rather than guess a role.
  return role ? ROLE_LABELS[role] : "Pending";
}

export function AdminUserTable({
  initialUsers,
  canManage,
  canEditNames,
  currentUserId,
  groupCount,
}: {
  initialUsers: AdminUserView[];
  /** Owner-only: inviting and changing roles. */
  canManage: boolean;
  /**
   * Separate from `canManage` because the name route admits admins too —
   * renaming carries no privilege, so it isn't owner-gated the way roles are.
   */
  canEditNames: boolean;
  currentUserId: string;
  groupCount: number;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState({ firstName: "", lastName: "" });
  const [savingName, setSavingName] = useState(false);

  // Derived from the roster being rendered, never hardcoded — so an optimistic
  // role change moves the stat in the same paint as the badge.
  const adminCount = users.filter((u) => u.role === "owner" || u.role === "admin").length;

  async function handleRoleChange(userId: string, newRole: Role) {
    const previousRole = users.find((u) => u.id === userId)?.role ?? null;
    setUsers((rows) => rows.map((r) => (r.id === userId ? { ...r, role: newRole } : r)));
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
      setUsers((rows) => rows.map((r) => (r.id === userId ? { ...r, role: previousRole } : r)));
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to update role");
    }
  }

  function startEditingName(user: AdminUserView) {
    setEditingNameId(user.id);
    // Seeded from the two halves the row already carries — splitting `name` on
    // a space would mangle anyone with two given names or a compound surname.
    setNameDraft({ firstName: user.firstName, lastName: user.lastName });
    setError(null);
    setNotice(null);
  }

  async function handleNameSave(userId: string) {
    setSavingName(true);
    setError(null);
    setNotice(null);

    const res = await fetch(`/admin/api/users/${userId}/name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nameDraft),
    });

    setSavingName(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to update the name");
      return;
    }

    // Not optimistic, unlike the role change: the route trims and normalizes,
    // so the row should show what was actually stored.
    const saved = (await res.json()) as { firstName: string; lastName: string };
    setUsers((rows) =>
      rows.map((r) =>
        r.id === userId
          ? {
              ...r,
              firstName: saved.firstName,
              lastName: saved.lastName,
              name: joinName(saved.firstName, saved.lastName),
            }
          : r,
      ),
    );
    setEditingNameId(null);
  }

  // overflow-hidden on the shell is load-bearing, not cosmetic: the sunburst
  // below is 160vmax wide and absolutely positioned, so without it the page
  // grows to the ray layer's width and the whole app scrolls sideways.
  return (
    <PageShell width="wide" surface="ink-deep" className="relative gap-6 overflow-hidden">
      {/* Screen 8's sunburst, bleeding off the top. */}
      <div
        aria-hidden="true"
        className="animate-spin-rays-slowest pointer-events-none absolute top-0 left-1/2 -z-10 aspect-square w-[160vmax] -translate-x-1/2 -translate-y-1/2 opacity-[.13] will-change-transform"
        style={{
          background: "repeating-conic-gradient(from 0deg, #FFF1D6 0deg 9deg, transparent 9deg 18deg)",
        }}
      />

      <header className="flex flex-col gap-2">
        <Label size={10} className="text-mango-yellow">
          👑 Platform roster
        </Label>
        <h1 className="font-display text-cream text-48">Who gets the keys</h1>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <StatTile value={users.length} label="Users" tone="yellow" on="dark" />
        <StatTile value={adminCount} label="Admins" tone="turquoise" on="dark" />
        <StatTile value={groupCount} label="Groups" tone="pink" on="dark" />
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" on="dark" onClick={() => setInviteOpen(true)}>
            Invite to platform
          </Button>
        </div>
      )}

      {error && (
        <Card tone="pink" border={4} radius={16} lift="xs" on="dark" className="px-3 py-2.5">
          <p role="alert" className="text-12 text-cream leading-snug">
            {error}
          </p>
        </Card>
      )}
      {notice && (
        <Card tone="turquoise" border={4} radius={16} lift="xs" on="dark" className="px-3 py-2.5">
          <p role="alert" className="text-12 text-ink leading-snug">
            {notice}
          </p>
        </Card>
      )}

      <ul className="flex flex-col gap-2.5">
        {users.map((u) => {
          const isSelf = u.id === currentUserId;
          const fill = ROLE_FILL[u.role ?? "pending"];
          return (
            <li key={u.id}>
              <Card
                tone="cream"
                on="dark"
                border={4}
                radius={18}
                lift="xs"
                // The design gives the super admin a yellow border instead of ink.
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 p-2.5",
                  u.role === "owner" && "border-mango-yellow",
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Avatar src={u.avatarUrl || null} name={u.name ?? u.email ?? "?"} size={34} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {editingNameId === u.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleNameSave(u.id);
                        }}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <input
                          className={NAME_INPUT}
                          aria-label={`First name for ${u.email ?? u.id}`}
                          value={nameDraft.firstName}
                          onChange={(e) =>
                            setNameDraft((d) => ({ ...d, firstName: e.target.value }))
                          }
                          maxLength={MAX_NAME_LENGTH}
                          placeholder="First"
                          autoFocus
                        />
                        <input
                          className={NAME_INPUT}
                          aria-label={`Last name for ${u.email ?? u.id}`}
                          value={nameDraft.lastName}
                          onChange={(e) =>
                            setNameDraft((d) => ({ ...d, lastName: e.target.value }))
                          }
                          maxLength={MAX_NAME_LENGTH}
                          placeholder="Last"
                        />
                        <Button type="submit" size="sm" disabled={savingName}>
                          {savingName ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          type="button"
                          tone="secondary"
                          size="sm"
                          onClick={() => setEditingNameId(null)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : canEditNames ? (
                      // The whole point of the issue: someone invited before
                      // the invite form asked for a name shows up blank, and
                      // an admin can fill it in without waiting for them.
                      <button
                        type="button"
                        onClick={() => startEditingName(u)}
                        aria-label={`Edit the name for ${u.email ?? u.id}`}
                        className={cn(
                          "font-display text-19 min-w-0 truncate text-left underline-offset-4 hover:underline",
                          "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink",
                          !u.name && "text-rust",
                        )}
                      >
                        {u.name ?? "Add name"}
                      </button>
                    ) : (
                      <span className="font-display text-19 min-w-0 truncate">{u.name ?? "—"}</span>
                    )}
                    {/* Email is body copy, never Anton: it is verbatim user
                        data and Anton would render it uppercase. */}
                    <span className="text-11 text-rust min-w-0 truncate font-medium">
                      {u.email ?? "—"} · joined {u.joined}
                    </span>
                  </span>
                </span>

                {canManage ? (
                  <select
                    value={u.role ?? ""}
                    // The PATCH route returns 403 for a caller targeting
                    // themselves, so an enabled control here would offer an
                    // action the API always refuses. This is also where the
                    // design's locked SUPER badge lands naturally.
                    disabled={isSelf}
                    title={isSelf ? "You cannot change your own role" : undefined}
                    aria-label={`Role for ${u.email ?? u.id}`}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                    // Kept as a <select> rather than the design's tap-to-cycle
                    // badge: it keeps keyboard access, the Pending state, and
                    // the self-disable above. Styled to read as the badge.
                    className={cn(
                      "font-display border-ink rounded-99 min-h-11 shrink-0 cursor-pointer border-3 border-solid px-3 text-14 uppercase",
                      "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink",
                      "disabled:cursor-not-allowed disabled:opacity-100",
                      fill,
                    )}
                  >
                    <option value="" disabled>
                      Pending
                    </option>
                    <option value="owner">Super Admin</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <span
                    className={cn(
                      "font-display border-ink rounded-99 inline-flex shrink-0 items-center border-3 border-solid px-3 py-1 text-14 uppercase",
                      fill,
                    )}
                  >
                    {roleLabel(u.role)}
                  </span>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

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
    </PageShell>
  );
}
