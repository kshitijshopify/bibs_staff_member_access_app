FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# `react-router build` below needs the build toolchain, so dev dependencies
# must stay installed here. Pruning them breaks the build.
RUN npm ci --include=dev && npm cache clean --force

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
