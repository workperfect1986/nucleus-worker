FROM node:24-bookworm-slim AS builder

WORKDIR /app
RUN npm install --global pnpm@11.16.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
RUN pnpm exec vinext build

FROM node:24-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app /app

EXPOSE 3000
CMD ["node", "node_modules/vinext/dist/cli.js", "start", "--host", "0.0.0.0"]
