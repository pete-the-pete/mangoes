"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmojiPicker } from "./EmojiPicker";

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
    <form onSubmit={submit} className="flex flex-col gap-4">
      {props.session?.isOverdue && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This session passed its end time and is still open. Close it when the
          group is done logging.
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          disabled={!props.canManage}
          className="rounded border border-gray-300 px-2 py-1"
        />
      </label>

      <div className="flex gap-4">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Starts (UTC)
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
            disabled={!props.canManage}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Ends (UTC)
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
            disabled={!props.canManage}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
      </div>

      <EmojiPicker
        options={props.itemTypes}
        selected={itemTypeKeys}
        disabled={!props.canManage}
        onChange={setItemTypeKeys}
      />

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">Participants</legend>
        {props.members.map((member) => (
          <label key={member.clerkUserId} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={participantIds.includes(member.clerkUserId)}
              disabled={!props.canManage}
              onChange={(e) =>
                setParticipantIds((ids) =>
                  e.target.checked
                    ? [...ids, member.clerkUserId]
                    : ids.filter((id) => id !== member.clerkUserId),
                )
              }
            />
            {member.name}
          </label>
        ))}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {props.canManage && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {isEdit ? "Save" : "Create session"}
          </button>
          {isEdit && props.session!.status !== "closed" && (
            <button
              type="button"
              onClick={() => setClosed(true)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              Close session
            </button>
          )}
          {isEdit && props.session!.status === "closed" && (
            <button
              type="button"
              onClick={() => setClosed(false)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              Reopen session
            </button>
          )}
        </div>
      )}
    </form>
  );
}
