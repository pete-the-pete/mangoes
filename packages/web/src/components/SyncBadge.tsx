export interface SyncBadgeProps {
  pendingCount: number;
  online: boolean;
  degraded: boolean;
}

/**
 * Queued-vs-synced, from `state.pending.length` and `state.online`. Never
 * blocks a tap — this is read-only status, rendered from whatever `useSession`
 * already has, never something a tap waits on.
 */
export function SyncBadge({ pendingCount, online, degraded }: SyncBadgeProps) {
  if (degraded) {
    return (
      <div className="rounded bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800">
        Offline storage unavailable — logging online only. Counts may take a few seconds to catch up.
      </div>
    );
  }
  if (!online) {
    return (
      <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
        Offline{pendingCount > 0 ? ` · ${pendingCount} queued` : ""}
      </div>
    );
  }
  if (pendingCount > 0) {
    return (
      <div className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
        Syncing {pendingCount}
      </div>
    );
  }
  return (
    <div className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Synced</div>
  );
}
