# X-Workspace — image production, nhiều tầng, chạy bằng người dùng không phải root (BASE-SEC-006).
# Ảnh nền ghim theo digest (BASE-DEP-008; tra từ registry 2026-11-23); Dependabot (docker) nâng digest hằng tuần.

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build không cần bí mật thật: instrumentation bỏ qua kiểm cấu hình khi `next build`.
RUN npm run build

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS runtime
WORKDIR /app
# Phiên bản phát hành (WF-REL-007): smoke test sau deploy so `version` của /api/health với tag; compose truyền qua
# `APP_VERSION` (build arg); không đặt thì health không nêu phiên bản.
ARG APP_VERSION=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_VERSION=${APP_VERSION}
# Người dùng không phải root có sẵn trong image node (uid 1000).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json next.config.mjs ./
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs
# Kho nội dung bằng chứng (ADR-0004): thư mục riêng, chủ là `node`, mount volume bền lên đây (compose: blobdata).
ENV BLOB_DIR=/data/blobs
RUN mkdir -p /data/blobs && chown -R node:node /data
VOLUME ["/data/blobs"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Trong container phải nghe 0.0.0.0 để Docker chuyển cổng được; compose chỉ publish ra 127.0.0.1.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node_modules/.bin/next start -H 0.0.0.0 -p 3000"]
