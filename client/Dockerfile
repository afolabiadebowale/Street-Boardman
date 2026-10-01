# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite bakes VITE_* in at build time. Empty (the default) means the build
# contains no Sentry code at all (TASK-042). A Sentry DSN is safe to ship
# to browsers — it only permits sending events, not reading them.
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_RELEASE=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE
RUN npm run build

# The client calls a relative /api, so it has to share an origin with the
# API — nginx serves the built SPA and proxies /api to API_UPSTREAM.
# nginx:alpine renders /etc/nginx/templates/*.template through envsubst at
# startup, which is how API_UPSTREAM reaches the config.
FROM nginx:1.27-alpine
ENV API_UPSTREAM=http://api:4000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
