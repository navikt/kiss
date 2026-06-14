FROM node:22-alpine AS builder

WORKDIR /app

ARG GITHUB_SHA
ENV GITHUB_SHA=${GITHUB_SHA}

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@10.33.0 && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm exec tsc server.ts --outDir . --module nodenext --moduleResolution nodenext --target es2022 --esModuleInterop --skipLibCheck --ignoreConfig

FROM node:22-alpine AS prod-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@10.33.0 && pnpm install --frozen-lockfile --prod

FROM europe-north1-docker.pkg.dev/cgr-nav/pull-through/nav.no/node:22-slim

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
