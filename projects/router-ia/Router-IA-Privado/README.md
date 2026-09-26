# Router IA

Router IA is a private, single-service app: one Express process serves the React
dashboard and API, routes OpenAI-compatible chat requests to configured
providers, and stores configuration and request metrics in PostgreSQL.

The Replit workspace remains useful for development, but the application runtime
does not depend on Replit. Supabase is selected with `SUPABASE_DATABASE_URL`;
`DATABASE_URL` remains a fallback for the existing Replit development workflow.

Router IA's configured PostgreSQL database stores its own provider credentials,
application-token hashes, owner record, and request metrics. Keep it separate
from the databases used by client apps such as Programa Hablando; those apps
connect to Router IA through the OpenAI-compatible API and do not need direct
access to Router IA's database.

## Requirements

- Node.js 24
- pnpm 10.26.1
- PostgreSQL, or a Supabase PostgreSQL database
- A Clerk instance for interactive dashboard sign-in

## Local development

1. Copy `.env.example` to `.env` and set the required values.
2. Install packages:

   ```sh
   pnpm install --frozen-lockfile
   ```

3. Apply the versioned schema migrations:

   ```sh
   pnpm db:migrate
   ```

4. Run the existing Replit artifact workflows, or run the portable app:

   ```sh
   pnpm build:portable
   pnpm start:portable
   ```

The portable app listens on `PORT` (default `8080`), serves the dashboard from
`STATIC_DIR`, and exposes the API below `/api`. `GET /health` checks both the
HTTP process and PostgreSQL. `GET /api/healthz` remains available as the
lightweight API liveness endpoint.

## Supabase PostgreSQL

1. Create or select the Supabase project and copy its PostgreSQL connection URL.
   Use the Supabase session pooler for the long-running Cloud Run service; use
   a direct or session-mode connection for running migrations. Avoid transaction
   pooler URLs for schema migrations.
   If the copied URI contains a password placeholder such as `[YOUR-PASSWORD]`,
   replace the entire placeholder, including the brackets, with the database
   password. Do not use an `anon` or service-role API key as the database
   password, and URL-encode reserved characters in the password.
2. Store the URL as `SUPABASE_DATABASE_URL` in the runtime's secret manager.
   This variable takes precedence over the Replit-provided `DATABASE_URL`.
3. Apply schema changes explicitly:

   ```sh
   pnpm db:migrate
   ```

4. Create a new versioned migration after changing the Drizzle schema:

   ```sh
   pnpm db:generate
   pnpm db:migrate
   ```

Do not use `push-force` for the external database. `pnpm db:migrate` applies
checked-in SQL migrations and records each applied version in
`drizzle.__drizzle_migrations`.

### Moving existing records

Schema migrations do not copy existing provider, token, owner, or usage rows.
For a data move, export the source database and import its data into the
Supabase project only after applying the matching schema migrations. Keep the
existing `SESSION_SECRET` unchanged: provider API keys are encrypted using it,
so changing it before re-encrypting those rows makes saved keys unreadable.
Treat database exports as sensitive because they include encrypted provider
credentials and token hashes. Do not commit exports or place them in public
storage.

## Authentication outside Replit

Replit-managed Clerk users and keys do not automatically transfer to another
runtime. Create or select an external Clerk instance and configure its
publishable and secret keys:

- `VITE_CLERK_PUBLISHABLE_KEY` at frontend build time
- `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` at runtime
- `CLERK_PROXY_ENABLED=false` unless the external Clerk instance is explicitly
  configured to use the app's Clerk proxy

Existing Replit preview and deployment behavior keeps its managed Clerk proxy
when `REPL_ID` is present. The first account to sign in claims ownership of
that database; keep the service private until the intended owner has signed in.

## Docker

Build and run the single-container app:

```sh
docker build -t router-ia .
docker run --rm -p 8080:8080 \
  -e SUPABASE_DATABASE_URL \
  -e SESSION_SECRET \
  -e CLERK_PUBLISHABLE_KEY \
  -e CLERK_SECRET_KEY \
  router-ia
```

The image serves both the built dashboard and API on port `8080`, runs as a
non-root user, and includes a Docker health check for `/health`. Supply runtime
secrets through the hosting platform's secret manager, not build arguments or
committed files.

## Google Cloud Run

Build from the repository root so Cloud Build uses the included multi-stage
`Dockerfile`. Configure:

- Container port: `8080`
- Startup/readiness HTTP check: `/health`
- Secret environment variables: `SUPABASE_DATABASE_URL`, `SESSION_SECRET`,
  `CLERK_SECRET_KEY`
- Runtime environment variables: `CLERK_PUBLISHABLE_KEY`,
  `CLERK_PROXY_ENABLED=false`, `STATIC_DIR=/app/public`
- Build environment variable: `VITE_CLERK_PUBLISHABLE_KEY`

Use a Cloud Run service account with access only to the required Secret Manager
secrets. Apply migrations as a separate, deliberate release step before sending
traffic to a new application revision. This repository does not deploy itself.

## API

- OpenAI-compatible endpoint: `POST /api/v1/chat/completions`
- Dashboard API: `/api/router/*`
- Health: `GET /health` and `GET /api/healthz`

Application tokens are named per client app and shown in full only once. Send
them as `Authorization: Bearer <token>` from a trusted server, never from
browser code. Metrics store provider, application, task type, latency, success,
and token counts; they do not store prompts or completions.

### Connect a client application

Create a named token in **Aplicaciones** and store it in the backend of the
client app as `ROUTER_IA_TOKEN`. Configure `ROUTER_IA_URL` to the complete
completion endpoint, for example
`https://<router-host>/api/v1/chat/completions`. The client project can live in a
different repository or workspace; it does not need provider keys or a direct
database connection.

Example from a Node.js server:

```js
const response = await fetch(process.env.ROUTER_IA_URL, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.ROUTER_IA_TOKEN}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    task_type: "coding",
    messages: [{ role: "user", content: "Explain this error." }],
  }),
});

if (!response.ok) {
  throw new Error(`Router IA returned HTTP ${response.status}`);
}

const completion = await response.json();
const answer = completion.choices[0].message.content;
```

The API accepts `model`, `provider_id`, `task_type`, `temperature`, and
`max_tokens` in addition to `messages`. Leave out `model` and `provider_id` to
let Router IA choose a compatible provider. Set `task_type` to `chat`, `coding`,
`reasoning`, `summarization`, `vision`, or `document` to select providers with
matching capabilities. Streaming is not supported.