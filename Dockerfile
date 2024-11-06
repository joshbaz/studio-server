FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Copy the rest of the files
COPY . .

# Install dependencies
RUN pnpm install 

# Add all the environment variables to the .env file
RUN printenv | sed 's/^\(.*\)$/export \1/g' > /app/.env

# add env variables to the build
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Build the studio
RUN pnpm build

# Expose the port
EXPOSE 8080

# Start the studio TODO: find a way to run the studio in production mode and to monitor the app with pm2
CMD ["./start.sh", "prod"]
