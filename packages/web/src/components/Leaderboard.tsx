import { groupTotal, subjectTotal, type Aggregate } from "core";

export interface LeaderboardItemType {
  key: string;
  emoji: string;
  label: string;
}

export interface LeaderboardParticipant {
  clerkUserId: string;
  name: string;
  imageUrl: string;
}

export interface LeaderboardProps {
  itemTypes: LeaderboardItemType[];
  participants: LeaderboardParticipant[];
  aggregate: Aggregate;
  me: string;
}

/**
 * Per-person, per-item counts plus a group total per item — this is the
 * spec's answer to "is the roster visible to every participant": a
 * leaderboard IS a roster, so there is no separate member-facing member
 * list anywhere. Reads `groupTotal`/`subjectTotal` from core rather than
 * summing counts by hand, per the milestone's constraint.
 */
export function Leaderboard({ itemTypes, participants, aggregate, me }: LeaderboardProps) {
  if (itemTypes.length === 0 || participants.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="p-2 text-left font-medium text-gray-500">Who</th>
            {itemTypes.map((t) => (
              <th key={t.key} className="p-2 text-center font-medium text-gray-500" title={t.label}>
                <span aria-hidden="true">{t.emoji}</span>
                <span className="sr-only">{t.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {participants.map((p) => (
            <tr key={p.clerkUserId} className={`border-b border-gray-100 ${p.clerkUserId === me ? "bg-gray-50 font-medium" : ""}`}>
              <td className="flex items-center gap-2 p-2">
                {p.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- small avatar, not worth next/image's setup here
                  <img src={p.imageUrl} alt="" className="h-6 w-6 rounded-full" />
                )}
                <span>{p.clerkUserId === me ? `${p.name} (you)` : p.name}</span>
              </td>
              {itemTypes.map((t) => (
                <td key={t.key} className="p-2 text-center tabular-nums">
                  {subjectTotal(aggregate, p.clerkUserId, t.key)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="p-2">Total</td>
            {itemTypes.map((t) => (
              <td key={t.key} className="p-2 text-center tabular-nums">
                {groupTotal(aggregate, t.key)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
