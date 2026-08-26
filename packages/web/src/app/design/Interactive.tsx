"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Modal } from "@/components/ui/Modal";
import { TextField, SelectField } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";

/** The parts of the kit that need state, split out so the page stays a server component. */
export function Interactive() {
  const [on, setOn] = useState(true);
  const [small, setSmall] = useState(false);
  const [modal, setModal] = useState(false);

  return (
    <div className="flex flex-col gap-8">
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
            <TextField label="Email" placeholder="name@gmail.com" type="email" />
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
