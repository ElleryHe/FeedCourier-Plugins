FROM node:24-alpine

WORKDIR /app
COPY server.mjs ./

ENV PORT=8787
ENV HOST=0.0.0.0

USER node
EXPOSE 8787

CMD ["node", "server.mjs"]
