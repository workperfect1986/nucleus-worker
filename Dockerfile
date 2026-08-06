FROM node:24-bookworm-slim AS builder

WORKDIR /app
RUN npm install --global pnpm@11.16.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY services/nucleus-worker/package.json services/nucleus-worker/pnpm-lock.yaml ./services/nucleus-worker/
RUN pnpm --dir services/nucleus-worker install --prod --frozen-lockfile

COPY . .
ENV NODE_ENV=production
RUN pnpm exec vinext build

FROM mcr.microsoft.com/playwright:v1.52.0-noble AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app /app

EXPOSE 3000
CMD ["node", "services/start-all.mjs"]
