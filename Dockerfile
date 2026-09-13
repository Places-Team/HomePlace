# syntax=docker/dockerfile:1

# ── deps ────────────────────────────────────────────────────────────────
FROM node:26-alpine AS deps
WORKDIR /app
# openssl must be present *before* `prisma generate` runs: Prisma picks its
# query engine from the OpenSSL it detects, and without one it silently falls
# back to the libssl 1.1 build, which then fails to load at runtime on an image
# that ships OpenSSL 3.
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# The postinstall hook runs `prisma generate`, which needs the schema — hence
# copying it before installing.
RUN npm install

# ── build ───────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma insists on a URL at generate time even though nothing connects during
# a build; the real one arrives from the environment at runtime.
ENV DATABASE_URL="file:/tmp/build.db"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3200
# Bind to every interface, not just the container's own hostname. Docker sets
# HOSTNAME to the container id, and Next's standalone server binds to exactly
# that — which leaves 127.0.0.1 refusing connections, so the healthcheck (and
# anything else on loopback inside the container) could never reach the app.
ENV HOSTNAME=0.0.0.0
# Default location of the database, also used by scripts run via `docker exec`.
ENV DATA_DIR=/data

# su-exec is how the entrypoint drops privileges after fixing ownership of the
# data directory — the container starts as root only long enough to do that.
# tzdata gives named zones (TZ=Europe/Moscow); without it Alpine stays on UTC.
RUN apk add --no-cache libc6-compat openssl su-exec tzdata

# `output: "standalone"` bundles only the files the server actually needs.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# The schema and the query engine travel with the image so the entrypoint can
# create the database on first start.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Password recovery, runnable inside the container. Next bundles bcryptjs into
# the server chunks rather than leaving it in node_modules, so the script needs
# its own copy.
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

# nodemailer is marked external (it reaches for node: built-ins webpack will not
# inline), so it is required at runtime and needs its own copy in the image.
COPY --from=builder /app/node_modules/nodemailer ./node_modules/nodemailer

COPY --from=builder /app/scripts ./scripts

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3200

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
