import Link from "next/link";
import { ButtonLink } from "./ui/Button";
import { Label } from "./ui/Label";

export interface EmptySessionsGroup {
  id: string;
  name: string;
}

export interface EmptySessionsProps {
  /** Groups the viewer actually belongs to. Empty means not invited anywhere yet. */
  groups: EmptySessionsGroup[];
}

/**
 * What a member sees when they take part in no sessions at all.
 *
 * Two states, not one. Group membership and session participation are separate
 * lists — `cycle_participants` is fixed when the session is created, from
 * whoever was a group member at that moment, and membership itself only lands
 * on the invitee's first authenticated request. So an admin who sets a session
 * up before someone's first sign-in cannot include them, and that person ends
 * up in the group and in none of its sessions.
 *
 * The old copy ("An admin will add you to a session") was accurate for both
 * states and useful for neither: it named no group, no session, and no next
 * step, so someone who had just been told they were added had no way to tell
 * whether the app was wrong or they were. Naming the group is the whole point.
 */
export function EmptySessions({ groups }: EmptySessionsProps) {
  const inAGroup = groups.length > 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <span aria-hidden="true" className="animate-bob text-[5rem] leading-none">
        🥭
      </span>
      <h1 className="font-display text-30">Nothing to log yet</h1>

      {inAGroup ? (
        <>
          <Label size={11} as="p" className="text-rust">
            You&rsquo;re in{" "}
            {groups.map((group, i) => (
              <span key={group.id}>
                {i > 0 && (i === groups.length - 1 ? " and " : ", ")}
                <Link
                  href={`/groups/${group.id}`}
                  className="text-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {group.name}
                </Link>
              </span>
            ))}
            , but you&rsquo;re not in any of {groups.length === 1 ? "its" : "their"} sessions
            yet.
          </Label>
          <Label size={11} as="p" className="text-rust">
            Sessions have their own list of who&rsquo;s taking part, so being in the group
            isn&rsquo;t enough — ask an admin to add you to the one you&rsquo;re meant to be
            logging in.
          </Label>
          <ButtonLink href={`/groups/${groups[0]!.id}`} tone="secondary" size="sm">
            See the group
          </ButtonLink>
        </>
      ) : (
        <Label size={11} as="p" className="text-rust">
          You&rsquo;re not in a group yet. An admin will add you to one, and to a session
          inside it.
        </Label>
      )}
    </div>
  );
}
