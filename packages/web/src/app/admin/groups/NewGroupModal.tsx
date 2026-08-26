"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";

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

  // Was a hand-rolled `fixed inset-0` overlay with no Escape handling and no
  // focus trap. Now the same Modal as every other dialog in the app.
  return (
    <Modal title="Build a crew" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="Cabo Crew"
        />
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
          <Button type="submit" tone="destructive" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create group"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
