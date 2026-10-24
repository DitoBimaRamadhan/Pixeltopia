# Root-level image for Docker hosts that build from the repo root
# (Back4app Containers, Zeabur, Hugging Face Spaces, Northflank, any VPS).
# Only server/ is copied; the Godot project is excluded via .dockerignore.
FROM node:20-alpine
WORKDIR /app
# Hosts usually inject PORT; 8080 is Back4app's default container port (HF Spaces: set PORT=7860).
ENV NODE_ENV=production PORT=8080
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/index.js ./
COPY server/lib ./lib
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "index.js"]
