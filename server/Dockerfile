# VibeHub server — build & run image for Railway (builder: DOCKERFILE, see railway.json).
# Railway service's Root Directory must be vibehub/server (see ../docs/ARCHITECTURE.md §8),
# so this build context is the server/ folder itself, not the monorepo root.

FROM node:20-alpine AS base
# Prisma's query engine needs OpenSSL — Alpine doesn't ship it by default.
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS deps
# server/ is an npm workspace — the lockfile lives at the monorepo root, outside this
# build context (Root Directory = vibehub/server), so plain `npm install` is used.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run db:generate
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

EXPOSE 4000
# Apply pending Postgres migrations, then boot. Baked into the image so it does not
# depend on the platform honouring railway.json's startCommand.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/index.js"]
