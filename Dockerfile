FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY voicetotext.py ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "voicetotext.py"]
