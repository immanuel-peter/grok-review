FROM node:22-alpine

RUN apk add --no-cache git ripgrep

WORKDIR /srv
COPY server.mjs ./

ENV NODE_ENV=production
ENV PORT=8080

# Runs as root only to drop each workspace's commands to its own uid.
EXPOSE 8080
CMD ["node", "server.mjs"]
