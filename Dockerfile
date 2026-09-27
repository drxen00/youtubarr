# ---- build stage -----------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY server server
COPY web web
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:24-alpine
WORKDIR /app

# yt-dlp + ffmpeg for opt-in downloads. yt-dlp is a Python app; alpine's package pulls python in.
RUN apk add --no-cache yt-dlp ffmpeg tini

ENV NODE_ENV=production \
    PORT=8790 \
    DATA_DIR=/data \
    MEDIA_DIR=/media

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/seeds server/seeds
COPY --from=build /app/web/dist web/dist

VOLUME ["/data", "/media"]
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8790/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
