# mangoes
Snacking socially

## Local development

Local dev runs against Postgres in Docker. Staging and production use the
Neon-backed Postgres provisioned through Vercel — those connection strings are
injected by Vercel and are not needed here.

```sh
cp .env.example .env      # then fill in the Clerk keys
docker compose up -d      # Postgres on localhost:5432
npm install
npm run migrate -w core   # creates the schema
```

`npm run migrate -w core` is idempotent — safe to re-run after every pull.

To migrate a hosted database instead, run the same script with
`DATABASE_URL_UNPOOLED` set to Neon's unpooled connection string (DDL over a
transaction pooler is unreliable).
