FROM node:22-alpine

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

RUN addgroup -S watcher && adduser -S watcher -G watcher
USER watcher

CMD ["node", "src/index.js"]
