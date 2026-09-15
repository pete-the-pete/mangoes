"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { TapTarget, layoutContainerClass } from "@/components/TapTarget";
import { CelebrationLayer, useCelebration } from "@/components/Celebration";
import { CELEBRATION_EFFECTS } from "@/lib/celebration";
import { Stagger } from "@/components/ui/Stagger";

/** The parts of the kit that need state, split out so the page stays a server component. */
export function Interactive() {
  const [on, setOn] = useState(true);
  const [small, setSmall] = useState(false);
  const [modal, setModal] = useState(false);

  // Each effect gets its own controller so the buttons below are deterministic
  // — one shared one with a forced value would still be fine, but this way the
  // page shows every effect as a separate, independently replayable thing.
  const rocket = useCelebration("rocket");
  const confetti = useCelebration("confetti");
  const clash = useCelebration("clash");
  const mania = useCelebration("mania");
  const mangonificient = useCelebration("mangonificient");
  const twoToMango = useCelebration("two-to-mango");
  const random = useCelebration();
  const controllers = {
    rocket,
    confetti,
    clash,
    mania,
    mangonificient,
    "two-to-mango": twoToMango,
    random,
  };

  // Tap counters for the grid/compact demo tiles, so the local pop is
  // reviewable here rather than only inside a real session.
  const [pops, setPops] = useState<Record<string, number>>({});
  // Remount key for the Stagger demo — replaying an entrance means mounting it
  // again, which is exactly what a real navigation does.
  const [staggerRun, setStaggerRun] = useState(0);
  const bump = (key: string) => {
    setPops((c) => ({ ...c, [key]: (c[key] ?? 0) + 1 }));
    random.fire();
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <Label size={12} className="text-rust">
          Celebration on log — the six effects
        </Label>
        <p className="text-12 text-rust max-w-prose leading-snug">
          Fires on every tap in the real session screen. Pure CSS: every keyframe
          lives in globals.css. Turn on OS reduce-motion and replay to
          see the reduced variant — flash and word mark only, no particles.
        </p>
        <div className="flex flex-wrap gap-2">
          {[...CELEBRATION_EFFECTS, "random" as const].map((name) => (
            <Button
              key={name}
              tone={name === "random" ? "secondary" : "primary"}
              size="sm"
              onClick={() => controllers[name].fire()}
            >
              {name}
            </Button>
          ))}
        </div>
        {Object.values(controllers).map((c, i) => (
          <CelebrationLayer key={i} state={c.state} reduced={c.reduced} />
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <Label size={12} className="text-rust">
          Stagger — list entrance
        </Label>
        <p className="text-12 text-rust max-w-prose leading-snug">
          Rows fly in and click into place on the design system&rsquo;s overshoot
          curve. Wraps server-rendered children, so the cards inside stay server
          components. Honours reduce-motion by rendering the plain container.
        </p>
        <Button tone="secondary" size="sm" onClick={() => setStaggerRun((n) => n + 1)}>
          Replay
        </Button>
        <Stagger key={staggerRun} className="flex flex-col gap-2.5">
          {["Sunday sundowners", "Taco Tuesday", "Friday finals", "Long weekend"].map((name) => (
            <Card key={name} tone="cream" border={4} radius={18} lift="xs" className="p-3">
              <span className="font-display text-20">{name}</span>
            </Card>
          ))}
        </Stagger>
      </section>

      <section className="flex flex-col gap-4">
        <Label size={12} className="text-rust">
          Tap target — hero (1 item type)
        </Label>
        <div className={layoutContainerClass(1)}>
          <TapTarget emoji="🥭" label="Mango" mine={12} group={87} size="large" disabled={false} onTap={() => {}} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Label size={12} className="text-rust">
          Tap target — grid (2-4) and compact (5+)
        </Label>
        <div className={layoutContainerClass(3)}>
          <TapTarget emoji="🥭" label="Mango" mine={12} group={87} size="grid" disabled={false} onTap={() => bump("mango")} popKey={pops["mango"] ?? 0} />
          <TapTarget emoji="🍹" label="Margarita" mine={3} group={21} size="grid" disabled={false} onTap={() => bump("marg")} popKey={pops["marg"] ?? 0} />
        </div>
        <div className={layoutContainerClass(6)}>
          <TapTarget emoji="🌮" label="Taco" mine={5} group={31} size="compact" disabled={false} onTap={() => bump("taco")} popKey={pops["taco"] ?? 0} />
          <TapTarget emoji="🍺" label="Beer" mine={2} group={14} size="compact" disabled={false} onTap={() => bump("beer")} popKey={pops["beer"] ?? 0} />
          <TapTarget emoji="🦪" label="Oyster" mine={0} group={6} size="compact" disabled onTap={() => {}} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Label size={12} className="text-rust">
          Toggles
        </Label>
        <Card tone="ink" className="flex items-center gap-6 p-5">
          <Toggle checked={on} onChange={setOn} label="Invite the whole group" />
          <Toggle checked={small} onChange={setSmall} label="Signup open" size="sm" />
          <Toggle checked={false} onChange={() => {}} label="Disabled" size="sm" disabled />
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <Label size={12} className="text-rust">
          Fields
        </Label>
        <div className="flex flex-col gap-4">
          <TextField label="Session name" defaultValue="Cabo Day 3" />
          <TextField label="Email (plain face)" defaultValue="tia@cabo.co" face="plain" />
          <SelectField label="Role" defaultValue="admin" hint="Owners cannot change their own role">
            <option value="owner">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </SelectField>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Label size={12} className="text-rust">
          Modal
        </Label>
        <div>
          <Button onClick={() => setModal(true)}>Invite user</Button>
        </div>
        {modal && (
          <Modal title="Invite a user" onClose={() => setModal(false)}>
            <TextField label="Email" placeholder="name@gmail.com" type="email" face="plain" />
            <div className="flex justify-end gap-3">
              <Button tone="secondary" size="sm" onClick={() => setModal(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => setModal(false)}>
                Send invite
              </Button>
            </div>
          </Modal>
        )}
      </section>
    </div>
  );
}
