# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS frontend-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM frontend-deps AS frontend-build
WORKDIR /app

COPY index.html tsconfig.json vite.config.ts tailwind.config.js postcss.config.js ./
COPY src ./src

ARG VITE_DEFAULT_SESSION_ID
ENV VITE_DEFAULT_SESSION_ID=${VITE_DEFAULT_SESSION_ID}

RUN npm run build

FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-bookworm-slim AS server-deps
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-bookworm-slim AS production
ARG TARGETPLATFORM
ARG TARGETARCH
ARG TARGETOS

ENV NODE_ENV=production \
    PORT=3001 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dumb-init \
    python3 \
    python3-pip \
    fontconfig \
    fonts-liberation \
    fonts-noto-cjk \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/index.js server/browser-service.js ./server/
COPY server/assets ./server/assets
COPY server/database ./server/database
COPY server/services ./server/services
COPY server/ecommerce-image-suite ./server/ecommerce-image-suite
COPY --from=frontend-build /app/dist ./dist

RUN pip3 install --break-system-packages --no-cache-dir openai requests urllib3 httpx pillow

RUN mkdir -p /app/server/data /app/logs \
    && cd /app/server \
    && npx playwright-core install chromium

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD curl -fsS http://127.0.0.1:3001/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
