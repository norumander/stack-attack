FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --no-frozen-lockfile

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY . .
RUN pnpm build

FROM node:20-slim AS runtime

RUN npm install -g serve@14

WORKDIR /app
COPY --from=build /app/src/dist ./dist
COPY serve.json ./dist/serve.json

ENV PORT=3000
EXPOSE 3000
CMD sh -c "serve dist -s -l $PORT"
