FROM node:20-alpine

WORKDIR /app

# Install dependencies first so rebuilds stay fast when source files change.
COPY package*.json ./
RUN npm ci

# Copy the rest of the app after dependencies are installed.
COPY . .

# Run the app as a non-root user for better security.
RUN addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

ENV HOST=0.0.0.0
ENV PORT=5173

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]