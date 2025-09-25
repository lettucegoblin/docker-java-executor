const express = require('express');
const Docker = require('dockerode');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const tar = require('tar-stream');

const app = express();
app.use(express.json({ limit: '50mb' }));


const docker = new Docker();
const PORT = process.env.PORT || 3000;
const PROJECT_LABEL = 'java-executor-service';
const CONTAINER_TIMEOUT_MS = 10000; // 10 seconds

// Initialize SQLite database
const db = new sqlite3.Database('java_executor.db');

// Initialize database tables
async function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // API keys table
      db.run(`
        CREATE TABLE IF NOT EXISTS api_keys (
          key TEXT PRIMARY KEY,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          description TEXT
        )
      `, (err) => {
        if (err) console.error('Error creating api_keys table:', err);
      });

      // Jobs table
      db.run(`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          api_key TEXT,
          status TEXT DEFAULT 'not_started',
          java_code TEXT,
          args TEXT,
          input_files TEXT,
          stdout TEXT,
          stderr TEXT,
          crashed BOOLEAN DEFAULT 0,
          timed_out BOOLEAN DEFAULT 0,
          memory_usage_mb REAL,
          cpu_percent_max REAL,
          execution_time_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          container_id TEXT,
          FOREIGN KEY (api_key) REFERENCES api_keys(key)
        )
      `, (err) => {
        if (err) console.error('Error creating jobs table:', err);
      });

      // Insert a default API key for testing (remove in production)
      db.run(`
        INSERT OR IGNORE INTO api_keys (key, description) 
        VALUES ('test-api-key-123', 'Default test API key')
      `, (err) => {
        if (err) console.error('Error inserting test API key:', err);
        resolve();
      });
    });
  });
}

// Middleware for API key authentication
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  db.get('SELECT key FROM api_keys WHERE key = ?', [apiKey], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.apiKey = apiKey;
    next();
  });
}

// Clean up orphaned containers on startup
async function cleanupOrphanedContainers() {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`project=${PROJECT_LABEL}`]
      }
    });

    for (const containerInfo of containers) {
      try {
        const container = docker.getContainer(containerInfo.Id);
        await container.remove({ force: true });
        console.log(`Cleaned up orphaned container: ${containerInfo.Id}`);
      } catch (err) {
        console.error(`Error removing container ${containerInfo.Id}:`, err);
      }
    }
  } catch (err) {
    console.error('Error during cleanup:', err);
  }
}

// Create a tar archive from Java code and input files
// This is the most efficient way to copy multiple files into a Docker container dynamically
async function createTarArchive(javaCode, inputFiles) {
  const pack = tar.pack();
  
  // Add the Java file
  pack.entry({ name: 'Main.java' }, javaCode);
  
  // Add input files
  if (inputFiles && Array.isArray(inputFiles)) {
    for (const file of inputFiles) {
      if (file.name && file.content) {
        pack.entry({ name: file.name }, file.content);
      }
    }
  }
  
  pack.finalize();
  
  // Convert to buffer
  const chunks = [];
  for await (const chunk of pack) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Execute Java code in Docker container
async function executeJavaInDocker(jobId) {
  return new Promise(async (resolve) => {
  let container = null;
  let timeout = null;
  let maxCpuPercent = 0;
  let maxMemoryMb = 0;
  let timedOut = false;
  const startTime = Date.now();

    try {
      // Get job details from database
      const job = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM jobs WHERE id = ?', [jobId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!job) {
        throw new Error('Job not found');
      }

      // Update job status to running
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE jobs SET status = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['running', jobId],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Parse input files
      const inputFiles = job.input_files ? JSON.parse(job.input_files) : [];
      const args = job.args ? JSON.parse(job.args) : [];

      // Create tar archive with Java code and input files
      const tarBuffer = await createTarArchive(job.java_code, inputFiles);

      // Create container with OpenJDK image
      container = await docker.createContainer({
        Image: 'openjdk:17-alpine',
        Cmd: [
          'sh', '-c',
          `cd /app && javac Main.java && java Main ${args.join(' ')}`
        ],
        WorkingDir: '/app',
        HostConfig: {
          AutoRemove: false,
          Memory: 512 * 1024 * 1024, // 512MB memory limit
          CpuShares: 512, // CPU shares (relative weight)
        },
        Labels: {
          project: PROJECT_LABEL,
          jobId: jobId
        }
      });

      // Update container ID in database
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE jobs SET container_id = ? WHERE id = ?',
          [container.id, jobId],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Copy files to container
      await container.putArchive(tarBuffer, { path: '/app' });

      // Start container
      const stream = await container.attach({ stream: true, stdout: true, stderr: true });
      await container.start();

      // Collect output
      let stdout = '';
      let stderr = '';
      
      stream.on('data', (chunk) => {
        // Docker multiplexed stream format
        const header = chunk.slice(0, 8);
        const type = header[0];
        const payload = chunk.slice(8);
        
        if (type === 1) {
          stdout += payload.toString();
        } else if (type === 2) {
          stderr += payload.toString();
        }
      });

      // Monitor container stats
      const statsStream = await container.stats({ stream: true });
      // Stats monitoring interval removed (was unused)

      statsStream.on('data', (data) => {
        try {
          const stats = JSON.parse(data.toString());
          
          // Calculate CPU percentage
          const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                          stats.precpu_stats.cpu_usage.total_usage;
          const systemDelta = stats.cpu_stats.system_cpu_usage - 
                             stats.precpu_stats.system_cpu_usage;
          const cpuPercent = (cpuDelta / systemDelta) * 
                            stats.cpu_stats.online_cpus * 100;
          
          if (cpuPercent > maxCpuPercent) {
            maxCpuPercent = cpuPercent;
          }
          
          // Calculate memory usage
          const memoryMb = stats.memory_stats.usage / (1024 * 1024);
          if (memoryMb > maxMemoryMb) {
            maxMemoryMb = memoryMb;
          }
        } catch (e) {
          // Ignore parse errors
        }
      });

      // Set timeout
      timeout = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill();
        } catch (e) {
          // Container might have already stopped
        }
      }, CONTAINER_TIMEOUT_MS);

      // Wait for container to finish
      const result = await container.wait();
      const executionTime = Date.now() - startTime;
      
      clearTimeout(timeout);
  // No statsInterval to clear
      statsStream.destroy();

      // Determine if crashed
      const crashed = result.StatusCode !== 0 && !timedOut;

      // Update job with results
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE jobs SET 
            status = 'done',
            stdout = ?,
            stderr = ?,
            crashed = ?,
            timed_out = ?,
            memory_usage_mb = ?,
            cpu_percent_max = ?,
            execution_time_ms = ?,
            completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            stdout.substring(0, 10000), // Limit output size
            stderr.substring(0, 10000),
            crashed ? 1 : 0,
            timedOut ? 1 : 0,
            maxMemoryMb,
            maxCpuPercent,
            executionTime,
            jobId
          ],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Clean up container
      try {
        await container.remove();
      } catch (e) {
        console.error('Error removing container:', e);
      }

      resolve({ success: true });

    } catch (error) {
      console.error('Error executing Java code:', error);
      
      // Update job status to failed
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE jobs SET 
            status = 'done',
            crashed = 1,
            stderr = ?,
            completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [error.message, jobId],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Clean up container if exists
      if (container) {
        try {
          await container.remove({ force: true });
        } catch (e) {
          console.error('Error removing container:', e);
        }
      }

      if (timeout) clearTimeout(timeout);
  // No statsInterval to clear

      resolve({ success: false, error: error.message });
    }
  });
}

// API Routes

// Submit a new Java execution job
app.post('/api/submit', authenticateApiKey, async (req, res) => {
  try {
    const { javaCode, args = [], inputFiles = [] } = req.body;

    if (!javaCode) {
      return res.status(400).json({ error: 'Java code is required' });
    }

    const jobId = uuidv4();

    // Insert job into database
    db.run(
      `INSERT INTO jobs (id, api_key, java_code, args, input_files, status) 
       VALUES (?, ?, ?, ?, ?, 'not_started')`,
      [
        jobId,
        req.apiKey,
        javaCode,
        JSON.stringify(args),
        JSON.stringify(inputFiles)
      ],
      (err) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to create job' });
        }

        // Execute job asynchronously
        executeJavaInDocker(jobId).catch(console.error);

        res.json({ 
          jobId, 
          status: 'not_started',
          message: 'Job submitted successfully' 
        });
      }
    );
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get job status and results
app.get('/api/job/:jobId', authenticateApiKey, (req, res) => {
  const { jobId } = req.params;

  db.get(
    'SELECT * FROM jobs WHERE id = ? AND api_key = ?',
    [jobId, req.apiKey],
    (err, job) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const response = {
        jobId: job.id,
        status: job.status,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at
      };

      if (job.status === 'done') {
        response.result = {
          stdout: job.stdout || '',
          stderr: job.stderr || '',
          crashed: job.crashed === 1,
          timedOut: job.timed_out === 1,
          memoryUsageMB: job.memory_usage_mb,
          cpuPercentMax: job.cpu_percent_max,
          executionTimeMs: job.execution_time_ms
        };
      }

      res.json(response);
    }
  );
});

// List all jobs for the API key
app.get('/api/jobs', authenticateApiKey, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

  db.all(
    `SELECT id, status, created_at, started_at, completed_at, 
            crashed, timed_out, execution_time_ms 
     FROM jobs 
     WHERE api_key = ? 
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`,
    [req.apiKey, limit, offset],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ jobs: rows });
    }
  );
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: PROJECT_LABEL });
});

// Start server
async function start() {
  try {
    // Initialize database
    await initDatabase();
    
    // Clean up any orphaned containers
    await cleanupOrphanedContainers();
    
    app.listen(PORT, () => {
      console.log(`Java Executor Service running on port ${PORT}`);
      console.log(`Default test API key: test-api-key-123`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await cleanupOrphanedContainers();
  db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await cleanupOrphanedContainers();
  db.close();
  process.exit(0);
});

start();