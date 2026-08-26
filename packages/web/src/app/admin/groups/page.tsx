import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore } from "@/lib/db";
import { GroupsTable, type GroupView } from "./GroupsTable";
import { PageShell } from "@/components/ui/PageShell";

const CREATED_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function GroupsPage() {
  const current = await getCurrentUserRole();
  // Unreachable: admin/layout.tsx redirects when this is null. A real branch
  // rather than a non-null assertion, matching admin/page.tsx.
  if (!current) {
    return null;
  }

  const cohorts =
    current.role === "owner"
      ? await cohortStore.listCohorts()
      : await cohortStore.listCohortsForUser(current.clerkUserId);

  const rows: GroupView[] = await Promise.all(
    cohorts.map(async (cohort) => ({
      id: cohort.id,
      name: cohort.name,
      created: CREATED_FMT.format(cohort.createdAt),
      memberCount: (await cohortStore.listMembers(cohort.id)).length,
    })),
  );

  return (
    <PageShell width="wide">
      <h1 className="font-display text-48">Groups</h1>
      <GroupsTable initialGroups={rows} />
    </PageShell>
  );
}
