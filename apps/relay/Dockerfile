FROM node:22-alpine
WORKDIR /srv
COPY package.json ./
RUN npm install --omit=dev
COPY dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
