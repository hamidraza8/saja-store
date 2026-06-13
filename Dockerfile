FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ src/
COPY public/ public/
COPY data/products.json data/products.json
RUN mkdir -p data/backups

EXPOSE 3000
CMD ["node", "src/server.js"]
