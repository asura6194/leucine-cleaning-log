# ---------------------------------------------------------------------------
# API image — a MULTI-STAGE build.
#
# Stage 1 ("build") has the full toolchain: TypeScript, dev dependencies, the
# lot. Stage 2 ("runtime") starts from a clean base and copies in only the
# compiled JavaScript and the production dependencies.
#
# Why bother: the toolchain is ~200 MB of compiler and test runner that the
# running server never uses. Anything left in the final image is code that has
# to be patched, scanned, and trusted. Shipping only what runs is both smaller
# and a smaller attack surface.
#
# NOTE ON BUILD CONTEXT: this Dockerfile is built from the REPOSITORY ROOT, not
# from api/, because the API's types come from ../shared. Docker cannot copy
# files from above its context, so the context has to be the parent of both.
# See docker-compose.yml, where `context: .` and `dockerfile: api/Dockerfile`.
# ---------------------------------------------------------------------------

# ---------- stage 1: build ----------
# "alpine" is a minimal Linux base — around 5 MB instead of ~120 MB for the
# Debian-based default. Pinned to a major version so a rebuild next month gets
# security patches but not Node 24.
FROM node:22-alpine AS build

WORKDIR /repo

# Copy ONLY the manifests first, then install. Docker caches each instruction
# as a layer and reuses it while its inputs are unchanged — so editing a source
# file re-runs the compile but NOT the install, which is the slow part.
# Copying package.json last would throw that cache away on every code change.
COPY api/package.json api/package-lock.json ./api/

# `npm ci` rather than `npm install`: it installs exactly what the lockfile
# pins and fails if the two disagree, so the image cannot quietly drift from
# what was tested.
RUN cd api && npm ci

# Now the sources. shared/ comes too — the API's wire types live there.
COPY api/tsconfig.json api/tsconfig.build.json ./api/
COPY api/src ./api/src
COPY api/scripts ./api/scripts
COPY shared ./shared

RUN cd api && npm run build

# ---------- stage 2: runtime ----------
FROM node:22-alpine AS runtime

# Node images ship a non-root `node` user. Containers run as root by default,
# which means a process escape is a root escape. Switching costs one line.
WORKDIR /app

ENV NODE_ENV=production

COPY api/package.json api/package-lock.json ./
# --omit=dev leaves out TypeScript, vitest, tsx and supertest.
RUN npm ci --omit=dev && npm cache clean --force

# The compiled output. Its shape mirrors the source tree, because the compiler
# had to keep api/ and shared/ distinct: dist/api/src/... and dist/shared/...
COPY --from=build /repo/api/dist ./dist

# The migration runner reads .sql files from disk at runtime, resolving them
# relative to its own location — so they have to sit where it expects them.
COPY api/migrations ./dist/api/migrations

USER node

EXPOSE 4000

# A container that is "up" is not necessarily serving. This asks the app the
# same question a load balancer would, and compose uses the answer to decide
# whether dependent services may start.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/api/src/server.js"]
