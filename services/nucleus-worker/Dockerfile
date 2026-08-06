FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app
RUN npm install --global pnpm@11.16.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY index.mjs ./

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "index.mjs"]
