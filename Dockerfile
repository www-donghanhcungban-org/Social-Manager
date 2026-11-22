# Social Manager — image production, nhiều tầng, chạy bằng người dùng không phải root (BASE-SEC-006).
# DEBT: ảnh nền ghim theo thẻ phiên bản, chưa ghim digest | trần: build không tái lập tuyệt đối |
# xem lại khi: có mạng tới registry để lấy digest (BASE-DEP-008) — thay `node:24-bookworm-slim` bằng `@sha256:…`.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build không cần bí mật thật: instrumentation bỏ qua kiểm cấu hình khi `next build`.
RUN npm run build

FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# Người dùng không phải root có sẵn trong image node (uid 1000).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json next.config.mjs ./
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Trong container phải nghe 0.0.0.0 để Docker chuyển cổng được; compose chỉ publish ra 127.0.0.1.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node_modules/.bin/next start -H 0.0.0.0 -p 3000"]
