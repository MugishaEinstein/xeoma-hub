FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY README.md plan.md ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV XEOMA_DEMO_MODE=true

EXPOSE 3000
CMD ["npm", "start"]
