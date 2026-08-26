import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { cohortStore } from "@/lib/db";
import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";

/**
 * The index `/groups/[groupId]` never had. Without it the nav has nowhere to
 * point and a member can only reach their own group by being handed the URL —
 * the group page has existed since v0.2 with no route into it.
 *
 * `auth()` rather than `getCurrentUserRole()`: this page needs a user id and
 * nothing else, and getCurrentUserRole would add a Clerk round trip plus the
 * invite-consuming writes that the landing page already runs.
 */
export default async function GroupsPage() {
  const { userId } = await auth();
  if (!userId) {
    // (member)/layout.tsx redirects signed-out visitors before this renders.
    return null;
  }

  const groups = await cohortStore.listCohortsForUser(userId);

  return (
    <PageShell>
      <h1 className="font-display text-42">Your groups</h1>

      {groups.length === 0 ? (
        <Label size={11} as="p" className="text-rust">
          You&rsquo;re not in a group yet. An admin will add you to one.
        </Label>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}`}
                className="rounded-20 block focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink"
              >
                <Card
                  tone="cream"
                  border={4}
                  radius={20}
                  lift="sm"
                  className="flex items-center justify-between gap-3 p-3.5"
                >
                  <span className="font-display text-20 min-w-0 truncate">{group.name}</span>
                  <span aria-hidden="true" className="font-display text-rust text-20 shrink-0">
                    →
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
