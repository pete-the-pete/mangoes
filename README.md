# mangoes
Snacking socially

## Local development

Local dev runs against Postgres in Docker. Staging and production use the
Neon-backed Postgres provisioned through Vercel — those connection strings are
injected by Vercel and are not needed here.

```sh
vercel env pull packages/web/.env.local  # Clerk keys + redirects, SUPER_ADMIN_EMAIL
docker compose up -d                     # Postgres on localhost:5432
npm install
npm run migrate -w core                  # creates the schema
npm run seed -w web                      # populates the emoji catalog
```

The seed is not optional. A session must declare at least one **enabled** item
type, so **session creation is blocked until `npm run seed -w web` has run** —
an empty `item_types` table leaves the picker with nothing to pick. It is
`INSERT ... ON CONFLICT (key) DO NOTHING`, so re-running it adds only what's
missing and never overwrites the Super Admin's enable/disable or relabel edits.

`.env.dev` holds the local defaults and is checked in — nothing to copy. To
point at a different database, put `DATABASE_URL` in a gitignored `.env`, which
is loaded after `.env.dev` and wins. A real shell variable beats both:

```sh
DATABASE_URL_UNPOOLED=<neon-unpooled-url> npm run migrate -w core
```

The pull target is `packages/web/.env.local`, not the repo root: the Vercel
project's root directory is `packages/web`, and `next dev` reads env files
relative to its own directory. A pull into the repo root would be invisible to
the app.

`npm run migrate -w core` is idempotent — safe to re-run after every pull.

DDL goes over the unpooled connection on purpose — a transaction pooler can
land it on a different backend than it started on.

## Tests

```sh
npm run test -w core       # 14 tests
npm run typecheck -w core  # tests + scripts, which `npm run build` doesn't cover
```

`packages/core`'s store tests run against the real local Postgres, so
`docker compose up -d` has to be running. They `DELETE FROM user_roles`, and
refuse to run against any host that isn't `localhost` or `127.0.0.1` — pointing
`DATABASE_URL` at a shared database will abort rather than wipe its table.

The test suite reads `.env.dev` then `.env` with the same precedence as
`npm run migrate -w core`, so both commands always agree on which database
they're talking to.

## Deployments

Vercel's root directory is `packages/web`, so it runs that package's scripts.
`vercel-build` takes precedence over `build` when present, which is where
migrations hang off:

```
vercel-build → npm run build --prefix ../core    (core's dist/, which the seed imports)
             → npm run migrate --prefix ../core  (schema)
             → npm run seed                      (emoji catalog)
             → npm run build → prebuild (builds core) → next build
```

Core is built first because the seed script imports the `core` package, which
resolves through core's gitignored `dist/`. `prebuild` still rebuilds it before
`next build`; `tsc -b` is incremental, so the second pass is nearly free.

Local `npm run build -w web` deliberately stays on plain `build` — it doesn't
run migrations, so building doesn't require Postgres to be up.

**Preview and Production share one Neon database.** No per-preview branching is
wired up, so every preview build applies its DDL to the same database
production reads. `schema.sql` is entirely `IF NOT EXISTS`, so today that's a
no-op — it stops being harmless at the first destructive migration, and
concurrent preview builds can race. The catalog seed is `ON CONFLICT DO
NOTHING`, so it lands in that shared database harmlessly for the same reason.
Tracked separately; wire up Neon's
copy-on-write preview branches before writing a migration that drops or
rewrites anything.
