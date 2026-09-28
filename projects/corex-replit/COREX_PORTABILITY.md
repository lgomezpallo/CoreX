# CoreX portability

CoreX can run outside Replit with Node.js and pnpm. Replit artifact metadata and workflows remain available for this workspace, but the application runtime does not require them.

## Requirements

- Node.js 20.19+ or 22.12+
- pnpm 10
- A Supabase project for sign-in and cloud snapshots
- A Router IA application key for AI generation

## Configure

```sh
cp .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLIC_KEY` for the browser build. Set `ROUTER_APP_KEY` in the server environment; do not use a `VITE_` prefix or expose this value to the browser. `ROUTER_URL` defaults to `https://router-ia.luisgomezpallo.workers.dev`. `ROUTER_APP_ID` is kept server-side; CoreX does not transmit it until Router IA's expected header or body field is confirmed.

The Supabase public key is intended for browser use. Never put a Supabase `service_role` key in the web app or `.env.example`.

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

The web app runs on port `5173`; the API runs on port `8080`. The local Vite server proxies `/api` to the API server. Set `WEB_PORT`, `API_PORT`, or `API_ORIGIN` to override those local defaults.

## Build and run

```sh
pnpm run build
pnpm start
```

`pnpm run build` type-checks the workspace and builds its packages. `pnpm start` serves the built web app and `/api` from one Express process. It uses `PORT` when provided and otherwise listens on `8080`. Build before starting. `COREX_STATIC_DIR` can point to the built `artifacts/habla-code/dist/public` directory if the files are stored elsewhere.

## External services and request flow

- Browser sign-in and cloud snapshots use Supabase.
- AI requests go from the API server to `POST ${ROUTER_URL}/api/v1/chat/completions`. The request uses the server-only Bearer `ROUTER_APP_KEY`, sends `task_type`, and omits `model`; Router IA owns provider and model routing.
- `GET /api/router/status` reports whether the Router connection is configured and the last in-process test result. `POST /api/router/test` makes one real `chat` request.
- Other application state that is described as local remains in the browser. Supabase snapshots are a separate cloud backup path.

## Separate web and API hosting

The standard `pnpm start` mode serves both pieces on one origin, avoiding proxy-specific paths. If hosting the static web build and API separately, route `/api/*` to the Express server and configure the static host to serve `index.html` for client-side routes. Set the web build's `BASE_PATH` only when the hosting proxy also serves the app under that prefix.

## Replit-only development metadata

`.replit-artifact/artifact.toml` files describe this workspace's previews and managed development workflows. They are not read by CoreX at runtime. The same API and web packages can be built and started with the commands above on a standard Node.js host.