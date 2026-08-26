"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SessionCard } from "@/components/SessionCard";
import { EmptySessions, type EmptySessionsGroup } from "@/components/EmptySessions";
import { PageShell } from "@/components/ui/PageShell";
import { Label } from "@/components/ui/Label";
import { SessionGroups } from "@/components/SessionGroups";
import type { SessionListItem } from "@/lib/memberSessions";

export interface SessionChooserProps {
  live: SessionListItem[];
  scheduled: SessionListItem[];
  recent: SessionListItem[];
  /** Only read when there are no sessions — see EmptySessions. */
  groups: EmptySessionsGroup[];
}

/**
 * Shown on `/` for a signed-in member with no valid current-session pointer.
 * Choosing a session PUTs `/api/current-session` (setting the pointer) and
 * navigates there — the one-time act that gives `/` something to redirect to
 * next time. Browsing `/sessions` later never repeats this PUT; that page is
 * a plain list, not another chooser.
 */
export function SessionChooser({ live, scheduled, recent, groups }: SessionChooserProps) {
  const router = useRouter();
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(sessionId: string) {
    setError(null);
    setChoosingId(sessionId);
    try {
      const res = await fetch("/api/current-session", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        setError("Could not open that session");
        setChoosingId(null);
        return;
      }
      router.push(`/sessions/${sessionId}`);
    } catch {
      setError("Could not open that session");
      setChoosingId(null);
    }
  }

  const isEmpty = live.length === 0 && scheduled.length === 0 && recent.length === 0;

  if (isEmpty) {
    return (
      <PageShell className="justify-center">
        <EmptySessions groups={groups} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 className="font-display text-42">Choose a session</h1>
      {error && (
        <Label size={11} as="p" role="alert" className="text-hot-pink">
          {error}
        </Label>
      )}
      <SessionGroups
        live={live}
        scheduled={scheduled}
        recent={recent}
        renderItem={(item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => choose(item.id)}
            disabled={choosingId !== null}
            className="w-full cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-50 rounded-20 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink"
          >
            <SessionCard {...item} />
          </button>
        )}
      />
    </PageShell>
  );
}
