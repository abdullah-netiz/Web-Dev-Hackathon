# Build and run the API. Context: ./backend
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# Dev dependencies are kept: the Prisma CLI is needed at start-up for `migrate deploy`
RUN pnpm prisma generate && pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 4000
# Apply migrations, then start; the BullMQ workers run in-process.
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/main.js"]
