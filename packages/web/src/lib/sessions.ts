import { deriveCycleStatus, isCycleOverdue, type CycleDetail } from "core";

const MAX_NAME_LENGTH = 80;

export interface SessionContext {
  /** Current members of the owning group — the only legal participants. */
  memberIds: string[];
  /** Keys of enabled catalog entries — disabled ones are picker-invisible. */
  enabledKeys: string[];
}

export interface CreateSessionFields {
  name: string;
  startsAt: Date;
  endsAt: Date;
  itemTypeKeys: string[];
  participantIds: string[];
}

export interface UpdateSessionFields {
  name?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
  itemTypeKeys?: string[] | undefined;
  participantIds?: string[] | undefined;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function parseName(raw: unknown): ParseResult<string> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return fail(`Name must be 1-${MAX_NAME_LENGTH} characters`);
  }
  return { ok: true, value: name };
}

function parseDate(raw: unknown, field: string): ParseResult<Date> {
  if (typeof raw !== "string") {
    return fail(`${field} must be an ISO date string`);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return fail(`${field} is not a valid date`);
  }
  return { ok: true, value: date };
}

function parseStringArray(raw: unknown, field: string): ParseResult<string[]> {
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    return fail(`${field} must be an array of strings`);
  }
  return { ok: true, value: raw as string[] };
}

function checkItemTypes(keys: string[], ctx: SessionContext): string | null {
  if (ctx.enabledKeys.length === 0) {
    return "This instance has no item types enabled — a Super Admin must enable at least one before a session can be created";
  }
  if (keys.length === 0) {
    return "Pick at least one item type";
  }
  const unknown = keys.filter((key) => !ctx.enabledKeys.includes(key));
  return unknown.length > 0
    ? `Unknown or disabled item type: ${unknown.join(", ")}`
    : null;
}

function checkParticipants(ids: string[], ctx: SessionContext): string | null {
  if (ids.length === 0) {
    return "Pick at least one participant";
  }
  const strangers = ids.filter((id) => !ctx.memberIds.includes(id));
  return strangers.length > 0
    ? "Every participant must be a member of this group"
    : null;
}

export function parseCreateSession(
  body: unknown,
  ctx: SessionContext,
): ParseResult<CreateSessionFields> {
  const raw = (body ?? {}) as Record<string, unknown>;

  const name = parseName(raw["name"]);
  if (!name.ok) return name;

  const startsAt = parseDate(raw["startsAt"], "startsAt");
  if (!startsAt.ok) return startsAt;

  const endsAt = parseDate(raw["endsAt"], "endsAt");
  if (!endsAt.ok) return endsAt;

  if (endsAt.value.getTime() <= startsAt.value.getTime()) {
    return fail("The session must end after it starts");
  }

  const itemTypeKeys = parseStringArray(raw["itemTypeKeys"], "itemTypeKeys");
  if (!itemTypeKeys.ok) return itemTypeKeys;
  const itemTypeError = checkItemTypes(itemTypeKeys.value, ctx);
  if (itemTypeError) return fail(itemTypeError);

  // Omitted means "everyone"; an explicit [] means the caller made a mistake.
  let participantIds = ctx.memberIds;
  if (raw["participantIds"] !== undefined) {
    const parsed = parseStringArray(raw["participantIds"], "participantIds");
    if (!parsed.ok) return parsed;
    participantIds = parsed.value;
  }
  const participantError = checkParticipants(participantIds, ctx);
  if (participantError) return fail(participantError);

  return {
    ok: true,
    value: {
      name: name.value,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      itemTypeKeys: itemTypeKeys.value,
      participantIds,
    },
  };
}

export function parseUpdateSession(
  body: unknown,
  ctx: SessionContext,
  current: { startsAt: Date; endsAt: Date },
): ParseResult<UpdateSessionFields> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const value: UpdateSessionFields = {};

  if (raw["name"] !== undefined) {
    const name = parseName(raw["name"]);
    if (!name.ok) return name;
    value.name = name.value;
  }

  if (raw["startsAt"] !== undefined) {
    const startsAt = parseDate(raw["startsAt"], "startsAt");
    if (!startsAt.ok) return startsAt;
    value.startsAt = startsAt.value;
  }

  if (raw["endsAt"] !== undefined) {
    const endsAt = parseDate(raw["endsAt"], "endsAt");
    if (!endsAt.ok) return endsAt;
    value.endsAt = endsAt.value;
  }

  // Validate the window the session will actually have, not the half being sent.
  const mergedStart = value.startsAt ?? current.startsAt;
  const mergedEnd = value.endsAt ?? current.endsAt;
  if (mergedEnd.getTime() <= mergedStart.getTime()) {
    return fail("The session must end after it starts");
  }

  if (raw["itemTypeKeys"] !== undefined) {
    const keys = parseStringArray(raw["itemTypeKeys"], "itemTypeKeys");
    if (!keys.ok) return keys;
    const error = checkItemTypes(keys.value, ctx);
    if (error) return fail(error);
    value.itemTypeKeys = keys.value;
  }

  if (raw["participantIds"] !== undefined) {
    const ids = parseStringArray(raw["participantIds"], "participantIds");
    if (!ids.ok) return ids;
    const error = checkParticipants(ids.value, ctx);
    if (error) return fail(error);
    value.participantIds = ids.value;
  }

  return { ok: true, value };
}

export function toSessionJson(cycle: CycleDetail, now: Date = new Date()) {
  return {
    id: cycle.id,
    name: cycle.name,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    status: deriveCycleStatus(cycle, now),
    isOverdue: isCycleOverdue(cycle, now),
    participantIds: cycle.participantIds,
    itemTypeKeys: cycle.itemTypeKeys,
  };
}
