# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

- Keep app generation independent of coding-specialist providers. Break complex requests into small, structured steps handled by interchangeable general-purpose providers, then validate and assemble the results so less capable models can participate.
- Organize creation into three stages: source intake, optional-base chat design, and app assembly/verification/publishing. Treat third-party APKs and websites as evidence for static analysis; distinguish observed details from inference, never execute untrusted APKs, and import code or assets directly only when the user has reuse rights.
- Keep the project portable outside Replit: GitHub is the source of truth for code, and Supabase is the target for persistent application data. Avoid adding Replit-specific persistence services; use portable interfaces and environment-configured connections. This remains subject to the $0 cost ceiling above: verify free-tier limits and prevent automatic overages before connecting services or persisting production data.

## Product

Every generated app must implement the behavior needed to fulfill the user's stated purpose; a visual preview with demo-only controls is not a finished app. Validate the key end-to-end flow before calling an app functional. If the requested behavior is not implemented, label the result as a prototype and state what remains incomplete.

- **Cost ceiling:** Keep all development, hosting, storage, build, and distribution costs at $0. Use only options whose free limits and billing behavior are understood; avoid paid usage, automatic overages, and automatic upgrades. Before enabling a service, verify that reaching a free limit cannot trigger a charge. If a feature cannot be provided at $0, do not enable it; explain the limitation and offer a free alternative or leave it as a prototype/deferred. Approval to expand capabilities does not waive this cost ceiling unless the user explicitly changes it.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
