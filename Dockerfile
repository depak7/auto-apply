# One image for every AutoApply process; the command picks which one runs:
#   api -> npm run api (API + UI)      worker -> npm run worker      apply-worker -> npm run apply-worker

# 1. Build the UI (needs the dev tools: Vite, Tailwind).
FROM node:25-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY web ./web
COPY src ./src
RUN npm run web:build

# 2. The runtime: production dependencies + Chromium, and the built UI.
#    Chromium goes to a fixed path outside $HOME, because platforms such as Heroku run the
#    container as a non-root user. Only the headless shell: the container never shows a window.
FROM node:25-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npm install --no-save tsx \
 && npx playwright install --with-deps --only-shell chromium \
 && chmod -R a+rX /ms-playwright

COPY tsconfig.json ./
COPY src ./src
COPY --from=web /app/web/dist ./web/dist

# DATA_DIR holds files only when no Vercel Blob token is set (compose mounts a volume there).
ENV DATA_DIR=/data NODE_ENV=production
CMD ["npm", "run", "api"]
