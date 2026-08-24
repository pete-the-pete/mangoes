"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("admin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A native <dialog> opened with showModal() gives Escape-to-close, focus
  // trapping, and inertness for the rest of the page for free — all of which a
  // hand-rolled `fixed inset-0` overlay would have to reimplement.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

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
      body: JSON.stringify({ email: trimmed, role }),
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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="invite-user-title"
      // Fires on Escape as well as an explicit close() — one path to unmount.
      onClose={onClose}
      // <dialog> has no built-in light-dismiss: a click landing on the element
      // itself rather than a child is a click on the backdrop.
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      className="w-80 rounded bg-white p-4 text-gray-900 shadow-lg backdrop:bg-black/40"
    >
      <form onSubmit={handleSubmit}>
        <h2 id="invite-user-title" className="mb-3 text-lg font-semibold">
          Invite user
        </h2>
        <label className="mb-2 block text-sm">
          Gmail address
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="friend@gmail.com"
            required
          />
        </label>
        <label className="mb-3 block text-sm">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="mt-1 w-full rounded border px-2 py-1"
          >
            {/* No "Super Admin" option: the invite route rejects role "owner".
                Owners are bootstrapped or promoted, never invited. */}
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="mb-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="px-3 py-1 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-teal-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
