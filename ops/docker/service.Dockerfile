# One image per service (relay, relayer, keeper, tape), built from the repo root:
#
#   docker build -f ops/docker/service.Dockerfile --build-arg SERVICE=tape -t unison-tape .
#
# Node only strips TypeScript types outside node_modules, so `pnpm deploy` (which copies workspace packages into
# node_modules) can't be used: the image keeps the workspace layout and runs services/$SERVICE/src/main.ts with
# --conditions=development, which resolves every @unison/* package to its TypeScript source.
FROM node:24-slim

ARG SERVICE
RUN test -n "$SERVICE" || (echo "build with --build-arg SERVICE=<relay|relayer|keeper|tape>" && exit 1)

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm \
  PATH=/pnpm:$PATH \
  CI=1 \
  NODE_ENV=production \
  SERVICE=$SERVICE
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

WORKDIR /app

# 1. every package the lockfile pins, fetched before any source is copied (cached across source changes)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --prod

# 2. only what this service runs: the shared packages, the service itself and the deployment documents
COPY packages/ packages/
COPY services/$SERVICE/ services/$SERVICE/
COPY deployments/ deployments/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --offline --frozen-lockfile --prod --filter "@unison/$SERVICE..."

COPY ops/docker/entrypoint.sh /usr/local/bin/unison-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/unison-entrypoint \
  && chmod 0755 /usr/local/bin/unison-entrypoint \
  && mkdir -p /data \
  && chown node:node /data

# tini reaps zombies and forwards signals; the entrypoint cds into services/$SERVICE and drops to `node`
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/unison-entrypoint"]
CMD ["sh", "-c", "exec node --conditions=development /app/services/$SERVICE/src/main.ts"]
