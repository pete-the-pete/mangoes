// Placeholder so /admin is an addressable route and the layout gate above it
// actually runs — a bare layout.tsx creates no route. Task 10 replaces this with
// the user table and invite modal.
export default function AdminPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-sm text-gray-500">User table coming in Task 10.</p>
    </div>
  );
}
