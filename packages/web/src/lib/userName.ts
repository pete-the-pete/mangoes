/**
 * Parsing for the first/last name fields carried by the invite forms, the
 * member's own /account form, and the admin roster's inline edit.
 *
 * Names live in Clerk (`firstName`/`lastName`), not in this app's database —
 * every read goes through Clerk, so there is nothing here to persist, only a
 * shared shape for "an optional, trimmed, length-capped name."
 */

/**
 * Clerk imposes no meaningful limit of its own, so this is ours: long enough
 * for a real name, short enough that the roster's `truncate` never has to hide
 * a paragraph someone pasted into the field.
 */
export const MAX_NAME_LENGTH = 64;

export type NameFieldResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validates one name field from a JSON body.
 *
 * Absent and blank both parse to `null` — a name is always optional, in every
 * form that uses it. `label` is the user-facing field name, so the caller
 * decides whether the message says "First name" or "Last name".
 */
export function parseNameField(raw: unknown, label: string): NameFieldResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `${label} must be text` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `${label} must be ${MAX_NAME_LENGTH} characters or less`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * The admin-facing display name: the two Clerk fields joined, or `null` when
 * the user has neither.
 *
 * Deliberately not deriveMemberDisplayName — that one exists for peer-facing
 * surfaces and substitutes UNNAMED_MEMBER. Admin surfaces want the empty case
 * to stay empty so they can render their own "—" and offer to fill it in.
 */
export function joinName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  return [firstName, lastName].filter(Boolean).join(" ") || null;
}
