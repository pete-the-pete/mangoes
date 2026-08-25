const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;

/** Invites are gmail-only (spec: API Surface). Both invite paths call this. */
export function isGmailAddress(email: string): boolean {
  return GMAIL_PATTERN.test(email);
}
