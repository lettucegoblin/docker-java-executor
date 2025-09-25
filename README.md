# Docker Java Executor Service

A Node.js server that manages Docker containers for executing Java code securely with resource monitoring and persistent result storage.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the Server](#running-the-server)
- [Running with Docker](#running-with-docker)
- [API Documentation](#api-documentation)
  - [Submit a Job](#submit-a-job)
  - [Get Job Status/Results](#get-job-statusresults)
  - [List Jobs](#list-jobs)
  - [Health Check](#health-check)
- [Usage Examples](#usage-examples)
  - [Simple Hello World](#simple-hello-world)
  - [With Arguments](#with-arguments)
  - [With Input Files](#with-input-files)
  - [Poll for Results](#poll-for-results)
- [Database Schema](#database-schema)
  - [api_keys Table](#api_keys-table)
  - [jobs Table](#jobs-table)
- [Security Considerations](#security-considerations)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)
  - [Container Cleanup](#container-cleanup)
  - [Database Reset](#database-reset)
  - [Docker Permission Issues](#docker-permission-issues)
- [License](#license)

## Features

- **Secure Java Execution**: Runs Java code in isolated Docker containers
- **API Key Authentication**: All endpoints require valid API keys
- **Job Management**: Submit jobs and poll for results
- **Resource Monitoring**: Tracks CPU usage, memory consumption, and execution time
- **Timeout Protection**: Automatically terminates long-running programs (10-second limit)
- **Persistent Storage**: SQLite database stores all job results
- **File Support**: Upload additional input files alongside Java code
- **Automatic Cleanup**: Removes orphaned containers on server restart

## Prerequisites

- Node.js 16+
- Docker installed and running
- Docker daemon accessible to the Node.js process

## Installation

```bash
# Clone or create the project directory
mkdir docker-java-executor
cd docker-java-executor

# Save the server.js file

# Install dependencies
npm install

# Pull the OpenJDK Docker image
docker pull openjdk:17-alpine
```

## Running the Server

```bash
# Start the server
npm start

# Or use nodemon for development
npm run dev
```

The server will run on port 3000 by default (configurable via `PORT` environment variable).

## Running with Docker

To run the service using Docker, first ensure you have Docker and Docker Compose installed.

The service is configured to run as a non-root user inside the container. To grant this user the necessary permissions to interact with the Docker socket, you must run the `docker compose` command with an environment variable that provides the GID of your host machine's `docker` group.

Execute the following command from the root of the project directory:

```bash
DOCKER_GID=$(getent group docker | cut -d: -f3) docker compose up --build
```

This command does the following:
- `DOCKER_GID=$(getent group docker | cut -d: -f3)`: This part dynamically gets the Group ID (GID) of the `docker` group on your host system and sets it as an environment variable for the command.
- `docker compose up --build`: This builds the Docker image if it's not already built and starts the service.

The server will be accessible on the port mapped in the `docker-compose.yml` file (e.g., `http://localhost:55392`).

## Environment Variables

The service uses the following environment variables:

- `NODE_ENV`: Set to `production` for production environments. Defaults to `development`.
- `PORT`: The port the server listens on inside the container. Defaults to `3000`.
- `DATABASE_PATH`: The path to the SQLite database file. Defaults to `java_executor.db`.
- `DOCKER_SOCKET_PATH`: The path to the Docker socket. Defaults to `/var/run/docker.sock` for Linux/WSL2. For Windows, use `//./pipe/docker_engine`.

## Default API Key

In non-production environments (`NODE_ENV !== 'production'`), a default API key (`test-api-key-123`) is created for testing purposes. This key is not created in production environments.

## Healthcheck

The service includes a healthcheck configuration in `docker-compose.yml` to verify the server's availability. The healthcheck sends a request to the `/health` endpoint every 30 seconds.

## Port Mapping

By default, the server listens on port `3000` inside the container. The `docker-compose.yml` file maps this to port `55392` on the host. Access the service at `http://localhost:55392`.

## API Documentation

All API endpoints require an `X-API-Key` header for authentication.

### Submit a Job

**POST** `/api/submit`

Submit Java code for execution.

**Headers:**
```
X-API-Key: your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "javaCode": "public class Main { public static void main(String[] args) { System.out.println(\"Hello World\"); } }",
  "args": ["arg1", "arg2"],
  "inputFiles": [
    {
      "name": "input.txt",
      "content": "File content here"
    }
  ]
}
```

**Response:**
```json
{
  "jobId": "uuid-here",
  "status": "not_started",
  "message": "Job submitted successfully"
}
```

### Get Job Status/Results

**GET** `/api/job/:jobId`

Poll for job status and retrieve results when complete.

**Headers:**
```
X-API-Key: your-api-key
```

**Response (Running):**
```json
{
  "jobId": "uuid-here",
  "status": "running",
  "createdAt": "2024-01-01T12:00:00.000Z",
  "startedAt": "2024-01-01T12:00:01.000Z"
}
```

**Response (Completed):**
```json
{
  "jobId": "uuid-here",
  "status": "done",
  "createdAt": "2024-01-01T12:00:00.000Z",
  "startedAt": "2024-01-01T12:00:01.000Z",
  "completedAt": "2024-01-01T12:00:03.000Z",
  "result": {
    "stdout": "Hello World\n",
    "stderr": "",
    "crashed": false,
    "timedOut": false,
    "memoryUsageMB": 45.2,
    "cpuPercentMax": 23.5,
    "executionTimeMs": 2150
  }
}
```

### List Jobs

**GET** `/api/jobs?limit=100&offset=0`

List all jobs for the authenticated API key.

**Headers:**
```
X-API-Key: your-api-key
```

**Response:**
```json
{
  "jobs": [
    {
      "id": "uuid-here",
      "status": "done",
      "created_at": "2024-01-01T12:00:00.000Z",
      "started_at": "2024-01-01T12:00:01.000Z",
      "completed_at": "2024-01-01T12:00:03.000Z",
      "crashed": 0,
      "timed_out": 0,
      "execution_time_ms": 2150
    }
  ]
}
```

### Health Check

**GET** `/health`

Check server health (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "service": "java-executor-service"
}
```

## Usage Examples

### Simple Hello World

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "X-API-Key: test-api-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "javaCode": "public class Main { public static void main(String[] args) { System.out.println(\"Hello from Docker!\"); } }"
  }'
```

### With Arguments

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "X-API-Key: test-api-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "javaCode": "public class Main { public static void main(String[] args) { for(String arg : args) System.out.println(arg); } }",
    "args": ["First", "Second", "Third"]
  }'
```

### With Input Files

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "X-API-Key: test-api-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "javaCode": "import java.io.*; import java.util.*; public class Main { public static void main(String[] args) throws IOException { Scanner sc = new Scanner(new File(\"data.txt\")); while(sc.hasNextLine()) System.out.println(sc.nextLine()); } }",
    "inputFiles": [
      {
        "name": "data.txt",
        "content": "Line 1\nLine 2\nLine 3"
      }
    ]
  }'
```

### Poll for Results

```bash
# Get the jobId from the submit response, then:
curl http://localhost:3000/api/job/YOUR-JOB-ID \
  -H "X-API-Key: test-api-key-123"
```

## Database Schema

The SQLite database (`java_executor.db`) contains two main tables:

### api_keys Table
- `key`: Primary key, the API key string
- `created_at`: Timestamp of key creation
- `description`: Optional description

### jobs Table
- `id`: Job UUID
- `api_key`: Associated API key
- `status`: not_started, running, or done
- `java_code`: Submitted Java code
- `args`: JSON array of arguments
- `input_files`: JSON array of input files
- `stdout`: Program output
- `stderr`: Error output
- `crashed`: Boolean flag
- `timed_out`: Boolean flag
- `memory_usage_mb`: Peak memory usage
- `cpu_percent_max`: Peak CPU percentage
- `execution_time_ms`: Total execution time
- `container_id`: Docker container ID
- Timestamps: created_at, started_at, completed_at

## Security Considerations

1. **Container Isolation**: Each job runs in an isolated container with resource limits
2. **Memory Limit**: 512MB per container
3. **CPU Shares**: Limited CPU allocation
4. **Timeout**: 10-second execution limit
5. **API Authentication**: All endpoints require valid API keys
6. **Input Validation**: Consider adding additional validation for production use
7. **Network Isolation**: Consider adding network restrictions for containers

## Production Deployment

For production use, consider:

1. **TLS/HTTPS**: Use a reverse proxy (nginx/Apache) with SSL certificates
2. **Rate Limiting**: Implement per-API-key rate limits
3. **Monitoring**: Add application monitoring and alerting
4. **Backup**: Regular SQLite database backups
5. **Docker Image Management**: Regularly update the OpenJDK image
6. **Resource Limits**: Adjust memory/CPU limits based on your needs
7. **Queue System**: Consider using a job queue for better scalability
8. **Log Management**: Implement proper logging and log rotation

## Troubleshooting

### Container Cleanup
If containers are left running:
```bash
# List all containers with the project label
docker ps -a --filter "label=project=java-executor-service"

# Remove all project containers
docker rm -f $(docker ps -aq --filter "label=project=java-executor-service")
```

### Database Reset
To reset the database:
```bash
rm java_executor.db
# Restart the server to recreate tables
```

### Docker Permission Issues
Ensure the Node.js process has access to the Docker socket:
```bash
# Add user to docker group (Linux)
sudo usermod -aG docker $USER
# Log out and back in for changes to take effect
```

## License

MIT