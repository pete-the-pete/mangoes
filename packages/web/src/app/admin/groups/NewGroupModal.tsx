"use client";

import { useState } from "react";

export function NewGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/admin/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not create the group");
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-3 rounded bg-white p-5"
      >
        <h2 className="text-lg font-semibold">New group</h2>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
