"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SessionCard } from "@/components/SessionCard";
import type { SessionListItem } from "@/lib/memberSessions";

export interface SessionChooserProps {
  live: SessionListItem[];
  scheduled: SessionListItem[];
  recent: SessionListItem[];
}

/**
 * Shown on `/` for a signed-in member with no valid current-session pointer.
 * Choosing a session PUTs `/api/current-session` (setting the pointer) and
 * navigates there — the one-time act that gives `/` something to redirect to
 * next time. Browsing `/sessions` later never repeats this PUT; that page is
 * a plain list, not another chooser.
 */
export function SessionChooser({ live, scheduled, recent }: SessionChooserProps) {
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
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-sm text-gray-500">No sessions yet — an admin will add you to one.</p>
      </div>
    );
  }

  function renderGroup(label: string, items: SessionListItem[]) {
    if (items.length === 0) return null;
    return (
      <section className="flex flex-col gap-2" key={label}>
        <h2 className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</h2>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => choose(item.id)}
              disabled={choosingId !== null}
              className="text-left disabled:opacity-50"
            >
              <SessionCard {...item} />
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Choose a session</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {renderGroup("Live", live)}
      {renderGroup("Scheduled", scheduled)}
      {renderGroup("Recent", recent)}
    </div>
  );
}
