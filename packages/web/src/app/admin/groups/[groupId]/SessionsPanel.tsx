import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Pill";
import type { CycleStatus } from "core";

export interface SessionView {
  id: string;
  name: string;
  window: string;
  status: CycleStatus;
  isOverdue: boolean;
  participantCount: number;
  itemEmoji: string[];
}

const STATUS_LABELS: Record<CycleStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  closed: "Closed",
};

export function SessionsPanel({
  groupId,
  sessions,
  canManage,
}: {
  groupId: string;
  sessions: SessionView[];
  canManage: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-30">Sessions</h2>
        {canManage && (
          <ButtonLink href={`/admin/groups/${groupId}/sessions/new`} tone="go" size="sm">
            New session
          </ButtonLink>
        )}
      </div>

      {sessions.length === 0 ? (
        <Card tone="cream" border={4} radius={18} lift="xs" className="flex flex-col gap-1 p-4">
          <span className="font-display text-20">No sessions yet</span>
          <Label size={10} as="p" className="text-rust">
            A session is a time-boxed window that counts a chosen set of items.
          </Label>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/admin/groups/${groupId}/sessions/${session.id}`}
                className="rounded-18 block focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink"
              >
                <Card
                  tone="cream"
                  border={4}
                  radius={18}
                  lift="xs"
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-display text-20 min-w-0 truncate">{session.name}</span>
                    <Label size={9} className="text-rust">
                      {session.window} · {session.participantCount}{" "}
                      {session.participantCount === 1 ? "person" : "people"}
                    </Label>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span aria-label={`${session.itemEmoji.length} item types`} className="text-16">
                      {session.itemEmoji.join(" ")}
                    </span>
                    <Pill tone={session.status === "live" ? "turquoise" : "cream"}>
                      {STATUS_LABELS[session.status]}
                    </Pill>
                    {/* Past its end time and still open — closing is explicit, so
                        this prompts rather than changing the state itself. */}
                    {session.isOverdue && <Pill tone="pink">Needs closing</Pill>}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
