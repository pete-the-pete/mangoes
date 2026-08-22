# mangoes
Snacking socially

## Local development

Local dev runs against Postgres in Docker. Staging and production use the
Neon-backed Postgres provisioned through Vercel — those connection strings are
injected by Vercel and are not needed here.

```sh
cp .env.example .env                     # local-only values (DATABASE_URL)
vercel env pull packages/web/.env.local  # Clerk keys, ULTRA_ADMIN_EMAIL
docker compose up -d                     # Postgres on localhost:5432
npm install
npm run migrate -w core                  # creates the schema
```

The pull target is `packages/web/.env.local`, not the repo root: the Vercel
project's root directory is `packages/web`, and `next dev` reads env files
relative to its own directory. A pull into the repo root would be invisible to
the app.

`npm run migrate -w core` is idempotent — safe to re-run after every pull.

To migrate a hosted database instead, run the same script with
`DATABASE_URL_UNPOOLED` set to Neon's unpooled connection string (DDL over a
transaction pooler is unreliable).
