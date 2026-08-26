"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField, SelectField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { MAX_NAME_LENGTH } from "@/lib/userName";

// Mirrors the server-side check in POST /admin/api/users/invite. Checked here
// first so an invalid address never costs a network round-trip; the server
// re-validates regardless, since this one is trivially bypassed.
const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;

export function InviteUserModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"admin" | "member">("admin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!GMAIL_PATTERN.test(trimmed)) {
      setError("Email must be a @gmail.com address");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch("/admin/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Name is optional — the invitee can set or change it themselves on
      // /account, and whatever they choose there wins over this.
      body: JSON.stringify({ email: trimmed, role, firstName, lastName }),
    });

    setSubmitting(false);
    if (!res.ok) {
      // Clerk's own message is passed through by the route (duplicate
      // invitation, rate limit, ...) — surface it rather than flattening it.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to send invite");
      return;
    }
    onInvited(trimmed);
  }

  // The native <dialog>, Escape handling, focus trap and light-dismiss all
  // live in Modal now — it is the one implementation for the app.
  return (
    <Modal title="Invite to platform" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          label="Gmail address"
          type="email"
          // `plain`: an address rendered in Anton would show the user
          // FRIEND@GMAIL.COM while submitting the lowercase value.
          face="plain"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@gmail.com"
          required
        />
        <div className="flex flex-wrap gap-3">
          <TextField
            label="First name"
            face="plain"
            className="min-w-[9rem] flex-1"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            placeholder="Ada"
          />
          <TextField
            label="Last name"
            face="plain"
            className="min-w-[9rem] flex-1"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            placeholder="Lovelace"
          />
        </div>
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}>
          {/* No "Super Admin" option: the invite route rejects role "owner".
              Owners are bootstrapped or promoted, never invited. */}
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </SelectField>
        {error && (
          <Card tone="pink" border={3} radius={16} lift="xs" className="px-3 py-2">
            <p role="alert" className="text-12 text-cream leading-snug">
              {error}
            </p>
          </Card>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" tone="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
