/**
 * The label a peer sees for a group/session member who hasn't set a Clerk
 * first or last name. Under v0.2's rule, email is admin-only data — this
 * label exists so no member-facing join can fall back to email (or invent a
 * name-shaped placeholder that could be mistaken for a real one).
 */
export const UNNAMED_MEMBER = "Unnamed member";

/**
 * Turns Clerk name fields into a display name for a peer-facing surface.
 * Deliberately takes only `firstName`/`lastName` — not the full Clerk user
 * object — so it can never reach for `primaryEmailAddress` even by mistake.
 */
export function deriveMemberDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName].filter(Boolean).join(" ") || UNNAMED_MEMBER;
}
