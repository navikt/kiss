FROM node:22-alpine AS builder

WORKDIR /app

ARG GITHUB_SHA
ENV GITHUB_SHA=${GITHUB_SHA}

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine AS prod-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["./node_modules/@react-router/serve/dist/cli.js", "./build/server/index.js"]
