# Multi-stage build for @heleket/sdk.
#
# - build stage compiles TypeScript and installs all dev dependencies
# - dev stage carries the source + dependencies so `node --test` and the
#   webhook example can run inside the container

FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi

COPY tsconfig*.json eslint.config.js .prettierrc .prettierignore ./
COPY src ./src
COPY test ./test
COPY examples ./examples
COPY bin ./bin

RUN npm run build

# ----------------------------------------------------------------------------

FROM node:20-alpine AS dev

WORKDIR /app

# Copy everything from the build stage. Keeps dev tooling (eslint, prettier)
# available so `npm run qa` works in-container.
COPY --from=build /app /app

ENV PATH="/app/node_modules/.bin:${PATH}"

CMD ["node", "--version"]
