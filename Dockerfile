FROM oven/bun:1-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS base
WORKDIR /app

FROM base AS dev
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "dev"]

FROM oven/bun:1-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS prod
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4202

RUN addgroup -S -g 1001 xynes \
    && adduser -S -u 1001 -G xynes -H xynes

COPY package.json bun.lock tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle

RUN bun install --frozen-lockfile \
    && rm -rf node_modules \
    && bun install --production --frozen-lockfile \
    && rm -rf /root/.bun /tmp/* \
    && chown -R xynes:xynes /app

USER xynes

EXPOSE 4202

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD bun run healthcheck || exit 1

CMD ["bun", "run", "src/index.ts"]
