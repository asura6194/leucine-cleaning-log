# ---------------------------------------------------------------------------
# Web image — multi-stage, and the two stages use completely different bases.
#
# Node builds the bundle. Node is then thrown away: a compiled single-page app
# is just static files, and serving static files is what nginx is for. The
# final image contains no JavaScript runtime at all.
#
# Built from the repository root, because the client imports its wire types
# from ../shared. See docker-compose.yml.
# ---------------------------------------------------------------------------

# ---------- stage 1: build the bundle ----------
FROM node:22-alpine AS build

WORKDIR /repo

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web/tsconfig.json web/vite.config.ts web/index.html ./web/
COPY web/src ./web/src
COPY shared ./shared

# `npm run build` is typecheck-then-bundle, so a type error fails the image
# build rather than shipping.
RUN cd web && npm run build

# ---------- stage 2: serve it ----------
FROM nginx:1.27-alpine AS runtime

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
