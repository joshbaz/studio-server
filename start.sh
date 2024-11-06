#!/bin/bash

# function to build the docker image and run the container
build(){
    echo "Running aesops API container..."

    # build the docker image
    docker-compose up --build -d --remove-orphans --force-recreate
    if [ $? -ne 0 ]; then
        echo "Failed to build the docker image."
        exit 1
    else
        echo "Prisma client generated successfully."
        echo "Container is up and running on PORT 8080 at HOST 0.0.0.0"
    fi
}

close(){
    echo "Stopping the container..."
    docker-compose down
    if [ $? -ne 0 ]; then
        echo "Failed to stop the container."
        exit 1
    else
        echo "Container stopped successfully."
    fi
}

# function to run in development
dev(){
    echo "Generating Prisma client..."
    prisma generate
    if [ $? -ne 0 ]; then
        echo "Failed to generate Prisma client."
        exit 1
    else
        echo "Prisma client generated successfully."
    fi

    echo "Starting aesops API in development mode..."
    pnpm dev
    if [ $? -ne 0 ]; then
        echo "Failed to start the API in development mode."
        exit 1
    else
        echo "API is running on http://localhost:4000"
    fi
}

# function to run in production
prod(){
    echo "Generating Prisma client..."
    prisma generate && prisma db push
    if [ $? -ne 0 ]; then
        echo "Failed to generate Prisma client."
        exit 1
    else
        echo "Prisma client generated successfully."
    fi
    echo "Starting aesops API in production mode..."
    node dist/index.js
    if [ $? -ne 0 ]; then
        echo "Failed to start the API in production mode."
        exit 1
    else
        echo "API is running in production mode."
    fi
}

echo "$1"

# check if the environment is production
if [ "$1" == "dev" ]; then
    dev
elif [ "$1" == "prod" ]; then
    prod
elif [ "$1" == "build" ]; then
    build
elif [ "$1" == "close" ]; then
    close
else
    echo "Usage: $0 {dev | prod | build | close }"
    exit 1
fi