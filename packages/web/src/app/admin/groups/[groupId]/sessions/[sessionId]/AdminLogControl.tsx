"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectField } from "@/components/ui/Field";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/components/ui/cn";

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
  //
  // A successful void also grows props.entries by one (it's a new ledger
  // entry too), so a void landing while a log is in flight can confirm the
  // wrong pending row one refresh early. The window is a single round trip;
  // not worth more machinery for that.
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
    <section className="border-ink mt-8 flex flex-col gap-4 border-t-4 border-solid pt-6">
      <h2 className="font-display text-30">Log for anyone</h2>

      <form onSubmit={submitLog} className="flex flex-wrap items-end gap-3">
        <SelectField
          label="Item"
          className="min-w-[10rem] flex-1"
          value={itemTypeKey}
          onChange={(e) => setItemTypeKey(e.target.value)}
        >
          {props.itemTypes.map((t) => (
            <option key={t.key} value={t.key}>
              {t.emoji} {t.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="For"
          className="min-w-[12rem] flex-1"
          value={subjectChoice}
          onChange={(e) => setSubjectChoice(e.target.value)}
        >
          <option value={GROUP_OPTION}>For the group (nobody in particular)</option>
          {props.participants.map((p) => (
            <option key={p.clerkUserId} value={p.clerkUserId}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <Button type="submit" tone="accent" disabled={isSubmitting || props.itemTypes.length === 0}>
          Log it
        </Button>
      </form>

      {error && (
        <Card tone="pink" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p role="alert" className="text-12 text-cream leading-snug">
            {error}
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        <Label size={10} as="h3" className="text-rust">
          Audit log · every edit is on the record
        </Label>

        {logEntries.length === 0 && pending.length === 0 && (
          <Label size={11} as="p" className="text-rust">
            No entries yet.
          </Label>
        )}

        {pending.map((p) => (
          <Card
            key={p.tempId}
            tone="cream"
            border={4}
            radius={16}
            lift="none"
            className="sticker-off flex items-center justify-between gap-3 p-2.5"
          >
            <span className="text-12 min-w-0 truncate font-medium">
              {p.subjectUserId ? nameFor(props.nameByClerkUserId, p.subjectUserId) : "the group"} —{" "}
              {props.itemTypes.find((t) => t.key === p.itemTypeKey)?.emoji} {p.itemTypeKey}
            </span>
            <Pill tone="yellow" className="shrink-0">
              Saving
            </Pill>
          </Card>
        ))}

        {logEntries.map((entry) => {
          const isVoided = voidedIds.has(entry.id) || voidingIds.has(entry.id);
          const itemType = props.itemTypes.find((t) => t.key === entry.itemTypeKey);
          const onBehalf = entry.subjectUserId !== entry.actorUserId;
          return (
            <Card
              key={entry.id}
              tone="cream"
              border={4}
              radius={16}
              lift={isVoided ? "none" : "xs"}
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 p-2.5",
                isVoided && "sticker-off",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {/* Screen 6's fixed rust time column, so descriptions line up. */}
                <Label
                  size={9}
                  as="time"
                  dateTime={entry.occurredAt}
                  className="text-rust shrink-0 tabular-nums"
                >
                  {formatUtc(entry.occurredAt)}
                </Label>
                <span className={cn("text-12 min-w-0 truncate font-medium", isVoided && "line-through")}>
                  {nameFor(props.nameByClerkUserId, entry.actorUserId)} logged{" "}
                  {itemType ? `${itemType.emoji} ${itemType.label}` : entry.itemTypeKey} for{" "}
                  {entry.subjectUserId
                    ? nameFor(props.nameByClerkUserId, entry.subjectUserId)
                    : "the group"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {/* The design's tag badges: yellow for an on-behalf log,
                    turquoise for an untagged group one, pink for a removal. */}
                <Pill tone={isVoided ? "pink" : entry.subjectUserId ? "yellow" : "turquoise"}>
                  {isVoided ? "Edit" : entry.subjectUserId ? (onBehalf ? "On behalf" : "Self") : "Group"}
                </Pill>
                {!isVoided && (
                  <Button
                    tone="destructive"
                    size="sm"
                    onClick={() => voidEntry(entry.id)}
                    aria-label={`Remove the entry logged at ${formatUtc(entry.occurredAt)}`}
                  >
                    Remove
                  </Button>
                )}
              </span>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
