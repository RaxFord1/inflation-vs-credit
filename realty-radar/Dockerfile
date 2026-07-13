# Realty Radar — легкий контейнер. node:sqlite вбудований, нативних збірок нема.
FROM node:22-slim

# (опційно) залежності для playwright, якщо увімкнеш браузерний фолбек для OLX/LUN
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
#     libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund

COPY . .
RUN node scripts/init.js || true

ENV NODE_ENV=production
EXPOSE 8787
# конфіг і БД монтуються томами (див. docker-compose.yml)
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
