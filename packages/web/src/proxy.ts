import { clerkMiddleware } from "@clerk/nextjs/server";

// Session context only — no gating here. Clerk v7 deprecated `createRouteMatcher`
// in favour of checking as close to the resource as possible, so authorization
// lives in `app/admin/layout.tsx` and in each route handler's `requireRole()`.
export default clerkMiddleware();

// Clerk's recommended matcher. It has to cover every path that calls `auth()` —
// `auth()` throws if the middleware didn't run for that request — which includes
// `/admin` and the `/admin/api/*` handlers added in Tasks 7-9.
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
