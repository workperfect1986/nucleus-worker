FROM node:24-bookworm-slim AS builder

WORKDIR /app
RUN npm install --global pnpm@11.16.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/nucleus-worker/package.json services/nucleus-worker/pnpm-lock.yaml ./services/nucleus-worker/
RUN NODE_ENV=development pnpm install --frozen-lockfile --prod=false \
    && test -f node_modules/vinext/dist/cli.js
RUN cd services/nucleus-worker && pnpm install --ignore-workspace --frozen-lockfile --prod

COPY . .
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod=false \
    && cd services/nucleus-worker \
    && pnpm install --ignore-workspace --frozen-lockfile --prod \
    && test -f node_modules/cheerio/package.json \
    && cd /app \
    && test -f node_modules/vinext/dist/cli.js \
    && node node_modules/vinext/dist/cli.js build

FROM mcr.microsoft.com/playwright:v1.52.0-noble AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app /app

EXPOSE 3000
CMD ["node", "services/start-all.mjs"]
