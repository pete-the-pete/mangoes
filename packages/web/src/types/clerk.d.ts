// Clerk ships `CustomJwtSessionClaims` as an empty, index-signature-only global
// interface for apps to augment. Declaration merging is the supported way to
// type whatever you added under Dashboard -> Sessions -> Customize session token.
//
// `metadata` is not in a Clerk session token by default. It is there because the
// app added `{"metadata": "{{user.public_metadata}}"}` to the session token
// template, which is what lets `getCurrentUserRole` read invitation state
// without a Clerk Backend API round trip. If that template entry is ever
// removed, the claim goes undefined, `hasPendingInvite` sees an empty object,
// and users stop having their invites consumed — so the two must change together.
interface CustomJwtSessionClaims {
  metadata?: Record<string, unknown>;
}
