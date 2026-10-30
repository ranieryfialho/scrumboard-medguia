FROM node:20-alpine AS base

# Dependências
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG EVOLUTION_API_URL
ARG EVOLUTION_API_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV EVOLUTION_API_URL=$EVOLUTION_API_URL
ENV EVOLUTION_API_KEY=$EVOLUTION_API_KEY
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# Dependências só de produção, para o worker
FROM base AS deps-prod
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Worker (`--target worker`): mesmo código, outro processo. O estágio `runner` só leva o build standalone do Next (sem
# `src/worker`, sem `tsx`, com `node_modules` podado); o worker precisa de tudo isso. Fica ANTES do runner para a imagem
# padrão continuar sendo a do site, que não muda.
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps-prod /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
USER node
CMD ["npm", "run", "worker"]

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NODE_OPTIONS="--max-old-space-size=1024"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# fase2c-anexos: o diretório existe na imagem com dono `nextjs`, para o volume
# nomeado `anexos` (docker-compose.yml) herdar essa permissão na 1ª montagem.
RUN mkdir -p /data/anexos && chown nextjs:nodejs /data/anexos

USER nextjs
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
