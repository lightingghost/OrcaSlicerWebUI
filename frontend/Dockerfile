# Stage 1: Build stage - Node 18 environment
FROM node:18 AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy application source code
COPY . .

# Accept API_SECRET as build argument
ARG VITE_API_SECRET=changeme
ENV VITE_API_SECRET=${VITE_API_SECRET}

# Build the application
RUN npm run build

# Stage 2: Serve stage - nginx alpine
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Start nginx (default command in nginx:alpine image)
CMD ["nginx", "-g", "daemon off;"]
