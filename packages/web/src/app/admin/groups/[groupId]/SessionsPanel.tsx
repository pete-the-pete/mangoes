import Link from "next/link";
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sessions</h2>
        {canManage && (
          <Link
            href={`/admin/groups/${groupId}/sessions/new`}
            className="rounded bg-black px-3 py-1.5 text-sm text-white"
          >
            New session
          </Link>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500">
          No sessions yet. A session is a time-boxed window that counts a chosen set of items.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-gray-500">
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Window</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">People</th>
              <th className="font-medium">Items</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="border-b">
                <td className="py-2">
                  <Link
                    href={`/admin/groups/${groupId}/sessions/${session.id}`}
                    className="hover:underline"
                  >
                    {session.name}
                  </Link>
                </td>
                <td className="text-gray-500">{session.window}</td>
                <td>
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {STATUS_LABELS[session.status]}
                  </span>
                  {/* Past its end time and still open — closing is explicit, so
                      this prompts rather than changing the state itself. */}
                  {session.isOverdue && (
                    <span className="ml-2 text-xs text-amber-700">ended — needs closing</span>
                  )}
                </td>
                <td>{session.participantCount}</td>
                <td aria-label={`${session.itemEmoji.length} item types`}>
                  {session.itemEmoji.join(" ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
