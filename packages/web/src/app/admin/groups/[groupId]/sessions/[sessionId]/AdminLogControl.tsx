"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface ItemTypeOption {
  key: string;
  emoji: string;
  label: string;
}

export interface ParticipantOption {
  clerkUserId: string;
  name: string;
}

/**
 * A local, admin-only view of a ledger entry. Deliberately not the member-facing
 * `EntryJson` from `@/lib/ledgerJson` — that DTO omits `voidsEntryId`, which this
 * view needs to know which log entries are already voided.
 */
export interface AdminEntryView {
  id: string;
  kind: "log" | "void";
  itemTypeKey: string;
  subjectUserId: string | null;
  actorUserId: string;
  voidsEntryId: string | null;
  /** ISO timestamp. */
  occurredAt: string;
}

export interface AdminLogControlProps {
  groupId: string;
  sessionId: string;
  canManage: boolean;
  /** Drawn from the session's own itemTypeKeys — the append route rejects anything else. */
  itemTypes: ItemTypeOption[];
  /** Drawn from the session's own participantIds — the append route rejects anyone else. */
  participants: ParticipantOption[];
  nameByClerkUserId: Record<string, string>;
  /** Newest first. */
  entries: AdminEntryView[];
}

/** Client-only sentinel for the "for the group" select option; never sent to the server. */
const GROUP_OPTION = "__group__";

interface PendingLog {
  tempId: string;
  itemTypeKey: string;
  subjectUserId: string | null;
}

function nameFor(map: Record<string, string>, clerkUserId: string): string {
  return map[clerkUserId] ?? clerkUserId;
}

/**
 * "YYYY-MM-DD HH:mm UTC" — the same UTC-labelled convention the session form
 * already uses (see `toUtcInputValue` in page.tsx). A client component still
 * renders on the server first, so locale/zone formatting here would be a
 * hydration mismatch waiting to happen.
 */
function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function AdminLogControl(props: AdminLogControlProps) {
  const router = useRouter();
  const [itemTypeKey, setItemTypeKey] = useState(props.itemTypes[0]?.key ?? "");
  const [subjectChoice, setSubjectChoice] = useState<string>(GROUP_OPTION);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<PendingLog[]>([]);
  const [voidingIds, setVoidingIds] = useState<Set<string>>(new Set());
  const prevEntryCount = useRef(props.entries.length);

  // The append route hands back only a cursor, not the entry it created, so a
  // pending row can't be matched by content. It is reconciled by count instead:
  // each successful append grows the server-refreshed list by exactly one, so
  // drop the oldest pending row per entry the refresh actually brought in —
  // first logged, first confirmed.
  useEffect(() => {
    const grew = props.entries.length - prevEntryCount.current;
    if (grew > 0) {
      setPending((current) => current.slice(grew));
    }
    prevEntryCount.current = props.entries.length;
  }, [props.entries.length]);

  async function submitLog(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!itemTypeKey) {
      setError("Pick an item type");
      return;
    }
    const subjectUserId = subjectChoice === GROUP_OPTION ? null : subjectChoice;
    const tempId = crypto.randomUUID();
    setPending((current) => [...current, { tempId, itemTypeKey, subjectUserId }]);
    setSubmitting(true);
    try {
      const res = await fetch(`/admin/api/groups/${props.groupId}/sessions/${props.sessionId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemTypeKey, subjectUserId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not log that");
        setPending((current) => current.filter((p) => p.tempId !== tempId));
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function voidEntry(entryId: string) {
    setError(null);
    setVoidingIds((current) => new Set(current).add(entryId));
    const res = await fetch(
      `/admin/api/groups/${props.groupId}/sessions/${props.sessionId}/entries/${entryId}/void`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not remove that log");
      setVoidingIds((current) => {
        const next = new Set(current);
        next.delete(entryId);
        return next;
      });
      return;
    }
    router.refresh();
  }

  if (!props.canManage) {
    return null;
  }

  const voidedIds = new Set(
    props.entries
      .filter((e) => e.kind === "void" && e.voidsEntryId !== null)
      .map((e) => e.voidsEntryId as string),
  );
  const logEntries = props.entries.filter((e) => e.kind === "log");

  return (
    <div className="mt-8 flex flex-col gap-4 border-t border-gray-200 pt-6">
      <h2 className="text-sm font-medium">Log on behalf</h2>
      <form onSubmit={submitLog} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Item
          <select
            value={itemTypeKey}
            onChange={(e) => setItemTypeKey(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          >
            {props.itemTypes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.emoji} {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          For
          <select
            value={subjectChoice}
            onChange={(e) => setSubjectChoice(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value={GROUP_OPTION}>For the group (nobody in particular)</option>
            {props.participants.map((p) => (
              <option key={p.clerkUserId} value={p.clerkUserId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={isSubmitting || props.itemTypes.length === 0}
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Log
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <h3 className="text-xs font-medium text-gray-500">Recent entries</h3>

        {logEntries.length === 0 && pending.length === 0 && (
          <p className="text-gray-500">No entries yet.</p>
        )}

        {pending.map((p) => (
          <div key={p.tempId} className="flex items-center justify-between gap-2 py-1 text-gray-400">
            <span>
              {p.subjectUserId ? nameFor(props.nameByClerkUserId, p.subjectUserId) : "group"} —{" "}
              {props.itemTypes.find((t) => t.key === p.itemTypeKey)?.emoji} {p.itemTypeKey}
            </span>
            <span>saving…</span>
          </div>
        ))}

        {logEntries.map((entry) => {
          const isVoided = voidedIds.has(entry.id) || voidingIds.has(entry.id);
          const itemType = props.itemTypes.find((t) => t.key === entry.itemTypeKey);
          return (
            <div
              key={entry.id}
              className={`flex items-center justify-between gap-2 border-b border-gray-100 py-1 ${
                isVoided ? "text-gray-400 line-through" : ""
              }`}
            >
              <span>
                {nameFor(props.nameByClerkUserId, entry.actorUserId)} logged{" "}
                {itemType ? `${itemType.emoji} ${itemType.label}` : entry.itemTypeKey} for{" "}
                {entry.subjectUserId ? nameFor(props.nameByClerkUserId, entry.subjectUserId) : "group"}
              </span>
              <span className="flex items-center gap-2 text-xs text-gray-500">
                {formatUtc(entry.occurredAt)}
                {!isVoided && (
                  <button
                    type="button"
                    onClick={() => voidEntry(entry.id)}
                    className="text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
