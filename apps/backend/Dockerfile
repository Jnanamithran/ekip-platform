FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json .
RUN npm install

COPY . .
RUN npx prisma generate --schema src/prisma/schema.prisma

EXPOSE 5000
CMD ["node", "src/index.js"]
