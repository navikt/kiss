FROM europe-north1-docker.pkg.dev/cgr-nav/pull-through/nav.no/node:26-dev AS builder

USER root

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

ARG GITHUB_SHA
ENV GITHUB_SHA=${GITHUB_SHA}

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm exec tsc server.ts --outDir . --module nodenext --moduleResolution nodenext --target es2022 --esModuleInterop --skipLibCheck --ignoreConfig



FROM europe-north1-docker.pkg.dev/cgr-nav/pull-through/nav.no/node:26-dev AS prod-deps

USER root

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod



FROM europe-north1-docker.pkg.dev/cgr-nav/pull-through/nav.no/node:26-slim

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server.js ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["server.js"]
