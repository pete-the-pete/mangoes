import { Card } from "./ui/Card";
import { Pill } from "./ui/Pill";

export interface SyncBadgeProps {
  pendingCount: number;
  online: boolean;
  degraded: boolean;
}

/**
 * Queued-vs-synced, from `state.pending.length` and `state.online`. Never
 * blocks a tap — this is read-only status, rendered from whatever `useSession`
 * already has, never something a tap waits on.
 *
 * The handoff's reference is screen 1's `3 QUEUED` chip. It has no design for
 * the degraded case, which postdates it: that one carries a full sentence and
 * gets a card, because a sentence crammed into a pill is unreadable.
 */
export function SyncBadge({ pendingCount, online, degraded }: SyncBadgeProps) {
  if (degraded) {
    return (
      <Card tone="yellow" border={3} radius={16} lift="xs" className="px-3 py-2">
        {/* Body copy, not a Label: this is a sentence to be read, and Label is
            uppercase and tracked at a size meant for two-word captions. */}
        <p className="text-12 text-ink leading-snug">
          Offline storage unavailable — logging online only. Counts may take a few seconds to catch up.
        </p>
      </Card>
    );
  }

  if (!online) {
    return (
      <Pill tone="cream" off>
        Offline{pendingCount > 0 ? ` · ${pendingCount} queued` : ""}
      </Pill>
    );
  }

  if (pendingCount > 0) {
    return (
      <Pill tone="yellow">
        {/* The pulsing dot is the handoff's live indicator; here it says
            "something is in flight" rather than "the session is live". */}
        <span aria-hidden="true" className="bg-ink animate-pulse-dot size-2 rounded-full" />
        {pendingCount} queued
      </Pill>
    );
  }

  return <Pill tone="turquoise">Synced</Pill>;
}
