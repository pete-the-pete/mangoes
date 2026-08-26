import { notFound } from "next/navigation";
import { AdminNav } from "@/app/admin/AdminNav";
import { AdminUserTable } from "@/app/admin/AdminUserTable";
import { AdminPanels } from "./AdminPanels";

/**
 * The admin half of the design kit. Dev-only, like /design.
 *
 * These screens all need auth, a seeded database and a real session to reach,
 * which made "does this actually render" an expensive question — expensive
 * enough that the first pass shipped them on typecheck alone. Every component
 * that did get looked at had a defect in it, so this exists to make looking
 * cheap.
 */
export default function AdminDesignPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <>
      {/* Rendered against the ink-deep roster below on purpose: the seam
          between the ink nav and the ink-deep page is the kind of thing that
          only shows up side by side. */}
      <AdminNav currentRole="owner" />
      <AdminUserTable
        canManage
        canEditNames
        currentUserId="u-self"
        groupCount={4}
        initialUsers={[
          {
            id: "u-self",
            name: "Pete",
            firstName: "Pete",
            lastName: "",
            email: "pete@gmail.com",
            avatarUrl: "",
            createdAt: "",
            joined: "Aug 19, 2026",
            role: "owner",
          },
          {
            id: "u2",
            name: "Dave",
            firstName: "Dave",
            lastName: "",
            email: "dave@gmail.com",
            avatarUrl: "",
            createdAt: "",
            joined: "Aug 20, 2026",
            role: "admin",
          },
          {
            id: "u3",
            name: "Marisol",
            firstName: "Marisol",
            lastName: "",
            email: "marisol@gmail.com",
            avatarUrl: "",
            createdAt: "",
            joined: "Aug 21, 2026",
            role: "member",
          },
          {
            id: "u4",
            name: null,
            firstName: "",
            lastName: "",
            email: "tia@gmail.com",
            avatarUrl: "",
            createdAt: "",
            joined: "Aug 25, 2026",
            role: null,
          },
        ]}
      />
      <AdminPanels />
    </>
  );
}
