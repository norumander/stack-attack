FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-slim AS runtime

RUN npm install -g serve@14

WORKDIR /app
COPY --from=build /app/src/dashboard/dist ./dist

ENV PORT=3000
EXPOSE 3000
CMD sh -c "serve dist -s -l $PORT"
