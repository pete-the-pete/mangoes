"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { NewGroupModal } from "./NewGroupModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Pill";

export interface GroupView {
  id: string;
  name: string;
  created: string;
  memberCount: number;
}

export function GroupsTable({ initialGroups }: { initialGroups: GroupView[] }) {
  const router = useRouter();
  const [isModalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button tone="primary" size="sm" onClick={() => setModalOpen(true)}>
          New group
        </Button>
      </div>

      {initialGroups.length === 0 ? (
        <Card tone="cream" border={4} radius={18} lift="xs" className="flex flex-col gap-1 p-4">
          <span className="font-display text-20">No groups yet</span>
          <Label size={10} as="p" className="text-rust">
            Create one to start setting up sessions.
          </Label>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {initialGroups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/admin/groups/${group.id}`}
                className="rounded-18 block focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink"
              >
                <Card
                  tone="cream"
                  border={4}
                  radius={18}
                  lift="xs"
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-display text-20 min-w-0 truncate">{group.name}</span>
                    <Label size={9} className="text-rust">
                      Created {group.created}
                    </Label>
                  </span>
                  <Pill tone="turquoise" className="shrink-0">
                    {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                  </Pill>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {isModalOpen && (
        <NewGroupModal
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            // The server component owns the list; re-render it rather than
            // duplicating group state on the client.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
