# mangoes
Snacking socially

## Local development

Local dev runs against Postgres in Docker. Staging and production use the
Neon-backed Postgres provisioned through Vercel — those connection strings are
injected by Vercel and are not needed here.

```sh
vercel env pull packages/web/.env.local  # Clerk keys, ULTRA_ADMIN_EMAIL
docker compose up -d                     # Postgres on localhost:5432
npm install
npm run migrate -w core                  # creates the schema
```

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
