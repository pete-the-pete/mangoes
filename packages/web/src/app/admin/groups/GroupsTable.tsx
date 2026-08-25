"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { NewGroupModal } from "./NewGroupModal";

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
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded bg-black px-3 py-1.5 text-sm text-white"
        >
          New group
        </button>
      </div>

      {initialGroups.length === 0 ? (
        <p className="text-sm text-gray-500">
          No groups yet. Create one to start setting up sessions.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2">Name</th>
              <th className="py-2">Members</th>
              <th className="py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {initialGroups.map((group) => (
              <tr key={group.id} className="border-b border-gray-100">
                <td className="py-2">
                  <Link href={`/admin/groups/${group.id}`} className="hover:underline">
                    {group.name}
                  </Link>
                </td>
                <td className="py-2">{group.memberCount}</td>
                <td className="py-2 text-gray-500">{group.created}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
