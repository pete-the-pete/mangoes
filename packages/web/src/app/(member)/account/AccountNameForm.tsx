"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { MAX_NAME_LENGTH } from "@/lib/userName";
import { useRefreshingAction } from "@/lib/useRefreshingAction";

export function AccountNameForm({
  initialFirstName,
  initialLastName,
}: {
  initialFirstName: string;
  initialLastName: string;
}) {
  const { busy, run } = useRefreshingAction();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setError(null);
      setSaved(false);

      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not save your name");
        return;
      }

      // Server truth, trimmed the way the route stored it — so the field shows
      // what peers will actually see rather than the untrimmed thing typed here.
      const body = (await res.json()) as { firstName: string; lastName: string };
      setFirstName(body.firstName);
      setLastName(body.lastName);
      setSaved(true);
      // Every surface that shows a name is server-rendered from Clerk, so the
      // rest of the app only catches up on the hook's refresh — which runs
      // inside this transition, so "Saving..." covers it too.
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <TextField
          label="First name"
          // `plain`: a name in Anton would show ADA while submitting "Ada".
          face="plain"
          className="min-w-[10rem] flex-1"
          value={firstName}
          onChange={(e) => {
            setFirstName(e.target.value);
            setSaved(false);
          }}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="given-name"
          placeholder="Ada"
        />
        <TextField
          label="Last name"
          face="plain"
          className="min-w-[10rem] flex-1"
          value={lastName}
          onChange={(e) => {
            setLastName(e.target.value);
            setSaved(false);
          }}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="family-name"
          placeholder="Lovelace"
        />
      </div>

      {error && (
        <Card tone="pink" border={3} radius={16} lift="xs" className="px-3 py-2">
          <p role="alert" className="text-12 text-cream leading-snug">
            {error}
          </p>
        </Card>
      )}
      {saved && (
        <Card tone="turquoise" border={3} radius={16} lift="xs" className="px-3 py-2">
          <p role="status" className="text-12 text-ink leading-snug">
            Saved.
          </p>
        </Card>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
