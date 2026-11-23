# Builds one image that serves everything: the web app, the API and the socket.io connection.
#
#   docker build -t twenty-tips .
#   docker run --rm -p 3000:3000 -e PORT=3000 twenty-tips      -> http://localhost:3000
#
# On Render the port comes from the PORT variable Render sets (see render.yaml).

# ---- 1. build the web app (frontend/dist) -------------------------------------------
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. build the server (backend/dist) ---------------------------------------------
FROM node:22-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---- 3. the image that runs: only what the server needs ------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend-build /app/backend/dist ./dist
# the server looks for the built web app in ../../frontend/dist, relative to dist/
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# do not run as root
USER node

ENV PORT=10000
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["node", "dist/index.js"]
