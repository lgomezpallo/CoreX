FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run typecheck
RUN pnpm --filter @workspace/api-server run build
RUN PORT=8080 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/router-ia run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public

WORKDIR /app
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app app

COPY --from=build --chown=app:app /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build --chown=app:app /app/artifacts/router-ia/dist/public ./public

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]