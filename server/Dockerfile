# Pixeltopia multiplayer server — works on Fly.io, Koyeb, Railway, Render (Docker), any VPS.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
COPY lib ./lib
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "index.js"]
