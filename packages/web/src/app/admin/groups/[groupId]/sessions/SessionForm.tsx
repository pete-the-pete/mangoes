"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmojiPicker } from "./EmojiPicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { Label } from "@/components/ui/Label";
import { cn } from "@/components/ui/cn";

export interface ItemTypeOption {
  key: string;
  emoji: string;
  label: string;
}

export interface MemberOption {
  clerkUserId: string;
  name: string;
}

export interface SessionFormProps {
  groupId: string;
  itemTypes: ItemTypeOption[];
  members: MemberOption[];
  canManage: boolean;
  session?: {
    id: string;
    name: string;
    startsAt: string; // "YYYY-MM-DDTHH:mm" in UTC, datetime-local shape
    endsAt: string;
    status: "scheduled" | "live" | "closed";
    isOverdue: boolean;
    itemTypeKeys: string[];
    participantIds: string[];
  };
  defaultItemTypeKey: string;
}

/** Shared by the two datetime-local inputs, which sit on colored cards rather
 *  than the white field surface the rest of the form uses. */
const DATE_INPUT =
  "font-display text-ink bg-cream border-ink rounded-16 min-h-11 w-full border-3 border-solid px-2.5 text-17 " +
  "outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function SessionForm(props: SessionFormProps) {
  const router = useRouter();
  const isEdit = props.session !== undefined;

  const [name, setName] = useState(props.session?.name ?? "");
  const [startsAt, setStartsAt] = useState(props.session?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(props.session?.endsAt ?? "");
  const [itemTypeKeys, setItemTypeKeys] = useState<string[]>(
    props.session?.itemTypeKeys ?? [props.defaultItemTypeKey],
  );
  const [participantIds, setParticipantIds] = useState<string[]>(
    props.session?.participantIds ?? props.members.map((m) => m.clerkUserId),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Client-side mirrors of the two server rules most likely to be hit, so the
    // common mistake never costs a round trip. The server re-checks regardless.
    if (itemTypeKeys.length === 0) {
      setError("Pick at least one item type");
      return;
    }
    if (participantIds.length === 0) {
      setError("Pick at least one participant");
      return;
    }

    setSubmitting(true);
    try {
      const url = isEdit
        ? `/admin/api/groups/${props.groupId}/sessions/${props.session!.id}`
        : `/admin/api/groups/${props.groupId}/sessions`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          // The fields are labelled UTC and the server renders them in UTC, so
          // the zoneless datetime-local value is read back as UTC. Without the
          // "Z" the browser would parse it in the viewer's zone and silently
          // shift a window two admins in different places would each see move.
          startsAt: new Date(`${startsAt}:00Z`).toISOString(),
          endsAt: new Date(`${endsAt}:00Z`).toISOString(),
          itemTypeKeys,
          participantIds,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save the session");
        return;
      }
      const body = await res.json();
      router.push(`/admin/groups/${props.groupId}/sessions/${body.session.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function setClosed(closed: boolean) {
    setError(null);
    const action = closed ? "close" : "reopen";
    const res = await fetch(
      `/admin/api/groups/${props.groupId}/sessions/${props.session!.id}/${action}`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not ${action} the session`);
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {props.session?.isOverdue && (
        <Card tone="yellow" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p className="text-12 text-ink leading-snug">
            This session passed its end time and is still open. Close it when the group is done
            logging.
          </p>
        </Card>
      )}

      <TextField
        label="Session name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
        disabled={!props.canManage}
      />

      {/* Screen 4's time box: two side-by-side cards, turquoise for the start
          and hot pink for the end. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card tone="turquoise" border={5} radius={20} lift="md" className="flex flex-col gap-1.5 p-3">
          <Label size={10} as="label" htmlFor="session-starts" className="text-ink/70">
            Starts (UTC)
          </Label>
          <input
            id="session-starts"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
            disabled={!props.canManage}
            className={DATE_INPUT}
          />
        </Card>
        <Card tone="pink" border={5} radius={20} lift="md" className="flex flex-col gap-1.5 p-3">
          <Label size={10} as="label" htmlFor="session-ends" className="text-cream/80">
            Ends (UTC)
          </Label>
          <input
            id="session-ends"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
            disabled={!props.canManage}
            // Not text-cream: the input keeps its own cream fill on both
            // cards, so cream text here would be invisible. Only the label
            // above changes color to sit on the pink card.
            className={DATE_INPUT}
          />
        </Card>
      </div>

      <EmojiPicker
        options={props.itemTypes}
        selected={itemTypeKeys}
        disabled={!props.canManage}
        onChange={setItemTypeKeys}
      />

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 w-full">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <Label size={10} className="text-rust">
              Who&rsquo;s in the crew · {participantIds.length} of {props.members.length}
            </Label>
            {/* A member added to the group after this session was created is
                not a participant of it — the two lists are separate, and
                nothing else in the UI says so. An admin who never notices is
                how someone ends up staring at "Nothing to log yet." */}
            {props.canManage && participantIds.length < props.members.length && (
              <button
                type="button"
                onClick={() => setParticipantIds(props.members.map((m) => m.clerkUserId))}
                className="font-display text-rust cursor-pointer text-15 underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                Add everyone
              </button>
            )}
          </span>
        </legend>
        {props.members.map((member) => {
          const checked = participantIds.includes(member.clerkUserId);
          return (
            // Screen 7's member picker: the whole row is the control, selected
            // rows solid and raised, unselected pressed down.
            <label
              key={member.clerkUserId}
              className={cn(
                "border-ink rounded-18 flex cursor-pointer items-center gap-3 border-4 border-solid p-2.5",
                "transition-[transform,box-shadow,opacity] duration-75 ease-out",
                "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink",
                checked ? "bg-cream shadow-sticker-sm shadow-ink" : "bg-cream sticker-off",
                !props.canManage && "cursor-not-allowed",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!props.canManage}
                onChange={(e) =>
                  setParticipantIds((ids) =>
                    e.target.checked
                      ? [...ids, member.clerkUserId]
                      : ids.filter((id) => id !== member.clerkUserId),
                  )
                }
                className="border-ink accent-mango-yellow size-7 shrink-0 cursor-pointer rounded-8 border-3 border-solid"
              />
              <span className="font-display text-19 min-w-0 truncate">{member.name}</span>
            </label>
          );
        })}
      </fieldset>

      {error && (
        <Card tone="pink" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p role="alert" className="text-12 text-cream leading-snug">
            {error}
          </p>
        </Card>
      )}

      {props.canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" tone="go" size="lg" disabled={isSubmitting}>
            {isEdit ? "Save" : "Go live 🚀"}
          </Button>
          {isEdit && props.session!.status !== "closed" && (
            <Button type="button" tone="destructive" onClick={() => setClosed(true)}>
              End session
            </Button>
          )}
          {isEdit && props.session!.status === "closed" && (
            <Button type="button" tone="accent" onClick={() => setClosed(false)}>
              Reopen session
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
