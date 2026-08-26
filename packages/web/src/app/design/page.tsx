import { notFound } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Pill";
import { SessionCard } from "@/components/SessionCard";
import { Avatar } from "@/components/ui/Avatar";
import { StatTile } from "@/components/ui/StatTile";
import { Interactive } from "./Interactive";

/**
 * A living style guide for the design system in docs/design/.
 *
 * Dev-only: every other screen needs auth and a seeded database, which makes
 * "did this primitive come out right" a slow question to answer. This page
 * needs neither, so it stays the fastest way to see a change — and it's where
 * a drift between a primitive and the handoff shows up first.
 */
export default function DesignPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="bg-cream flex flex-1 flex-col gap-10 p-6">
      <header className="flex flex-col gap-2">
        <Label size={15} className="text-rust">
          Design system
        </Label>
        <h1 className="font-display text-52">Sticker kit</h1>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-4">
          <Button tone="primary">Log it</Button>
          <Button tone="accent">+1 for the group</Button>
          <Button tone="destructive">End session</Button>
          <Button tone="go" size="lg">
            Go live 🚀
          </Button>
          <Button tone="secondary" size="sm">
            Cancel
          </Button>
          <Button tone="primary" disabled>
            Disabled
          </Button>
          <ButtonLink href="/design" tone="primary" size="sm">
            A link
          </ButtonLink>
        </div>
        <Card tone="ink" radius={22} className="flex flex-wrap items-center gap-4 p-5">
          <Label size={10} className="text-mango-yellow w-full">
            On a dark surface — the shadow inverts to cream
          </Label>
          <Button tone="secondary" on="dark">
            Nudge
          </Button>
          <Button tone="primary" on="dark">
            Invite to platform
          </Button>
        </Card>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone="yellow">Super</Pill>
          <Pill tone="turquoise">Admin</Pill>
          <Pill tone="cream">Member</Pill>
          <Pill tone="orange">Invited</Pill>
          <Pill tone="pink">Edit</Pill>
          <Pill tone="cream" off>
            Off state
          </Pill>
          <Pill tone="yellow" size="md">
            Mango 🥭
          </Pill>
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid gap-5 sm:grid-cols-2">
          <Card tone="cream" className="p-5">
            <span className="font-display text-24">Cream</span>
          </Card>
          <Card tone="yellow" className="p-5">
            <span className="font-display text-24">Yellow</span>
          </Card>
          <Card tone="turquoise" className="p-5">
            <span className="font-display text-24">Turquoise</span>
          </Card>
          <Card tone="pink" className="p-5">
            <span className="font-display text-24">Hot pink</span>
          </Card>
          <Card tone="ink" className="p-5">
            <span className="font-display text-24">Ink</span>
          </Card>
          <Card tone="ink-deep" className="p-5">
            <span className="font-display text-24">Ink deep</span>
          </Card>
          <Card tone="ink-deep" on="light" lift="lg" className="col-span-full p-5">
            <Label size={10} className="text-mango-yellow">
              Shadow follows the surface, not the fill
            </Label>
            <div className="mt-3 flex flex-wrap gap-4">
              <Card tone="cream" on="dark" className="p-4">
                <span className="font-display text-20">Cream on dark</span>
              </Card>
              <Card tone="yellow" on="dark" className="p-4">
                <span className="font-display text-20">Yellow on dark</span>
              </Card>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-3">
          <span className="font-display text-104">150</span>
          <span className="font-display text-42">Stat number</span>
          <span className="font-display text-20">Row name</span>
          <Label size={13} className="text-rust">
            Tracked label
          </Label>
          <p className="text-14 max-w-prose">
            Body copy is Space Grotesk and is <strong>not</strong> uppercased, which is what keeps
            user-entered text intact — an email like tia@cabo.co, or a group name someone typed.
          </p>
          <span className="font-display text-mango-yellow text-stroke-6 text-56">Blast off!!</span>
        </div>
      </Section>

      <Section title="SessionCard (first real consumer)">
        <div className="flex max-w-md flex-col gap-3">
          <SessionCard
            name="Cabo Day 3"
            status="live"
            isOverdue={false}
            window="Today · 9:00–23:00"
            itemEmoji={["🥭", "🍹"]}
          />
          <SessionCard
            name="Cabo Day 4"
            status="scheduled"
            isOverdue={false}
            window="Tomorrow · 9:00–23:00"
            itemEmoji={["🥭"]}
          />
          <SessionCard
            name="Cabo Day 2"
            status="closed"
            isOverdue={false}
            window="Yesterday"
            itemEmoji={["🥭", "🌮", "🍺"]}
          />
          <SessionCard
            name="Ski Trip Opening Night"
            status="live"
            isOverdue
            window="Started 4h ago"
            itemEmoji={["🍺"]}
          />
        </div>
      </Section>

      <Section title="Avatars">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name="Dave" size={44} />
          <Avatar name="Marisol" size={38} />
          <Avatar name="Sam" size={36} />
          <Avatar name="Jo" size={34} />
          <Avatar name="Tia R." size={28} />
          <Avatar name={null} size={34} />
        </div>
      </Section>

      <Section title="Stat tiles">
        <div className="grid grid-cols-3 gap-3">
          <StatTile value={7} label="Users" tone="yellow" />
          <StatTile value={2} label="Admins" tone="turquoise" />
          <StatTile value={4} label="Groups" tone="pink" />
        </div>
      </Section>

      <Interactive />

      <Section title="Motion">
        <div className="flex flex-wrap items-center gap-8">
          <span className="animate-bob inline-block text-[64px]">🥭</span>
          <span className="bg-turquoise animate-pulse-dot inline-block size-4 rounded-full" />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <Label size={12} className="text-rust">
        {title}
      </Label>
      {children}
    </section>
  );
}
