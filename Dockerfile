FROM node:20-alpine

# Install curl for healthchecks
RUN apk add --no-cache curl

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./

# Create data directory for SQLite
RUN mkdir -p /app/data

# Create a non-root user and add it to a new group, and also to the docker group GID.
ARG DOCKER_GID=999
RUN addgroup -S nodejs && \
    adduser -S nodejs -G nodejs && \
    if ! getent group ${DOCKER_GID}; then \
        addgroup -g ${DOCKER_GID} -S docker; \
    fi && \
    addgroup nodejs $(getent group ${DOCKER_GID} | cut -d: -f1)

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]