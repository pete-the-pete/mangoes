"use client";

import { useState } from "react";
import { GroupsTable } from "@/app/admin/groups/GroupsTable";
import { MembersPanel } from "@/app/admin/groups/[groupId]/MembersPanel";
import { SessionsPanel } from "@/app/admin/groups/[groupId]/SessionsPanel";
import { EmojiPicker } from "@/app/admin/groups/[groupId]/sessions/EmojiPicker";
import { AdminLogControl } from "@/app/admin/groups/[groupId]/sessions/[sessionId]/AdminLogControl";
import { ItemTypeTable } from "@/app/admin/item-types/ItemTypeTable";
import { Label } from "@/components/ui/Label";
import { PageShell } from "@/components/ui/PageShell";

const ITEM_TYPES = [
  { key: "mango", emoji: "🥭", label: "Mango" },
  { key: "margarita", emoji: "🍹", label: "Margarita" },
  { key: "taco", emoji: "🌮", label: "Taco" },
  { key: "beer", emoji: "🍺", label: "Beer" },
  { key: "oyster", emoji: "🦪", label: "Oyster" },
];

const NAMES = { "u-self": "Pete", u2: "Dave", u3: "Marisol" };

export function AdminPanels() {
  const [picked, setPicked] = useState(["mango", "taco"]);

  return (
    <PageShell width="wide" className="gap-10">
      <Section title="Groups">
        <GroupsTable
          initialGroups={[
            { id: "g1", name: "Cabo Crew", created: "Aug 19, 2026", memberCount: 6 },
            { id: "g2", name: "Ski Trip", created: "Aug 22, 2026", memberCount: 1 },
          ]}
        />
      </Section>

      <Section title="Members panel">
        <MembersPanel
          groupId="g1"
          canManage
          currentUserId="u-self"
          initialMembers={[
            { clerkUserId: "u-self", name: "Pete", email: "pete@gmail.com", avatarUrl: null, role: "admin" },
            { clerkUserId: "u2", name: "Dave", email: "dave@gmail.com", avatarUrl: null, role: "member" },
            { clerkUserId: "u3", name: "Marisol", email: "marisol@gmail.com", avatarUrl: null, role: "member" },
          ]}
          initialInvites={[
            { id: "i1", email: "tia@cabo.co" },
            { id: "i2", email: "sam@gmail.com" },
          ]}
        />
      </Section>

      <Section title="Sessions panel">
        <SessionsPanel
          groupId="g1"
          canManage
          sessions={[
            {
              id: "s1",
              name: "Cabo Day 3",
              window: "Aug 25 09:00 – 23:00",
              status: "live",
              isOverdue: false,
              participantCount: 6,
              itemEmoji: ["🥭", "🍹"],
            },
            {
              id: "s2",
              name: "Cabo Day 2",
              window: "Aug 24 09:00 – 23:00",
              status: "live",
              isOverdue: true,
              participantCount: 6,
              itemEmoji: ["🥭"],
            },
            {
              id: "s3",
              name: "Cabo Day 1",
              window: "Aug 23 09:00 – 23:00",
              status: "closed",
              isOverdue: false,
              participantCount: 5,
              itemEmoji: ["🥭", "🌮", "🍺"],
            },
          ]}
        />
      </Section>

      <Section title="Item picker (session form)">
        <EmojiPicker options={ITEM_TYPES} selected={picked} disabled={false} onChange={setPicked} />
      </Section>

      <Section title="Item type catalog (stays a table)">
        <ItemTypeTable
          initialItemTypes={ITEM_TYPES.map((t, i) => ({
            ...t,
            enabled: i < 3,
            position: i,
          }))}
        />
      </Section>

      <Section title="Log on behalf + audit log">
        <AdminLogControl
          groupId="g1"
          sessionId="s1"
          canManage
          itemTypes={ITEM_TYPES.slice(0, 2)}
          participants={[
            { clerkUserId: "u-self", name: "Pete" },
            { clerkUserId: "u2", name: "Dave" },
            { clerkUserId: "u3", name: "Marisol" },
          ]}
          nameByClerkUserId={NAMES}
          entries={[
            {
              id: "e1",
              kind: "log",
              itemTypeKey: "mango",
              subjectUserId: "u2",
              actorUserId: "u-self",
              voidsEntryId: null,
              occurredAt: "2026-08-25T22:14:00.000Z",
            },
            {
              id: "e2",
              kind: "log",
              itemTypeKey: "margarita",
              subjectUserId: null,
              actorUserId: "u-self",
              voidsEntryId: null,
              occurredAt: "2026-08-25T21:02:00.000Z",
            },
            {
              id: "e3",
              kind: "log",
              itemTypeKey: "mango",
              subjectUserId: "u3",
              actorUserId: "u3",
              voidsEntryId: null,
              occurredAt: "2026-08-25T20:41:00.000Z",
            },
          ]}
        />
      </Section>
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Label size={12} className="text-rust">
        {title}
      </Label>
      {children}
    </section>
  );
}
