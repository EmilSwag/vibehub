# VibeHub web — build & run image for Railway (builder: DOCKERFILE, see railway.json).
# Railway service's Root Directory must be vibehub/web (see ../docs/ARCHITECTURE.md §8).
# Static Vite build, served in production by `serve` (a real dependency, not npx'd at
# runtime, so container start doesn't depend on registry access).

FROM node:20-alpine AS deps
WORKDIR /app
# web/ is an npm workspace — the lockfile lives at the monorepo root, which is outside
# this build context (Root Directory = vibehub/web), so plain `npm install` is used.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM deps AS build
# Vite inlines VITE_* at build time. Railway passes service variables as Docker build
# args only when they are declared with ARG here.
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 4173
CMD ["npm", "run", "start"]
