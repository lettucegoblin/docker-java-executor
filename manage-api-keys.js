#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const readline = require('readline');

const DB_PATH = process.env.DATABASE_PATH || './java_executor.db';
const db = new sqlite3.Database(DB_PATH);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

function generateApiKey() {
  return 'jexec_' + crypto.randomBytes(32).toString('hex');
}

async function listApiKeys() {
  console.log('\n=== API Keys ===');
  db.all('SELECT key, description, created_at FROM api_keys ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      console.error('Error:', err);
      return;
    }
    
    if (rows.length === 0) {
      console.log('No API keys found.');
    } else {
      rows.forEach(row => {
        console.log(`\nKey: ${row.key}`);
        console.log(`Description: ${row.description || 'N/A'}`);
        console.log(`Created: ${new Date(row.created_at).toLocaleString()}`);
      });
    }
    
    showMenu();
  });
}

async function createApiKey() {
  const description = await question('\nEnter description for the new API key: ');
  const key = generateApiKey();
  
  db.run(
    'INSERT INTO api_keys (key, description) VALUES (?, ?)',
    [key, description],
    (err) => {
      if (err) {
        console.error('Error creating API key:', err);
      } else {
        console.log('\n✅ API Key created successfully!');
        console.log(`Key: ${key}`);
        console.log('Please save this key securely. It cannot be retrieved later.');
      }
      showMenu();
    }
  );
}

async function deleteApiKey() {
  const key = await question('\nEnter the API key to delete: ');
  
  // Check if key exists and has associated jobs
  db.get('SELECT COUNT(*) as count FROM jobs WHERE api_key = ?', [key], (err, row) => {
    if (err) {
      console.error('Error:', err);
      showMenu();
      return;
    }
    
    if (row.count > 0) {
      console.log(`\n⚠️  Warning: This API key has ${row.count} associated jobs.`);
      console.log('Deleting the key will NOT delete the job records.');
    }
    
    question('\nAre you sure you want to delete this key? (yes/no): ').then(confirm => {
      if (confirm.toLowerCase() === 'yes') {
        db.run('DELETE FROM api_keys WHERE key = ?', [key], function(err) {
          if (err) {
            console.error('Error deleting API key:', err);
          } else if (this.changes === 0) {
            console.log('\n❌ API key not found.');
          } else {
            console.log('\n✅ API key deleted successfully.');
          }
          showMenu();
        });
      } else {
        console.log('Deletion cancelled.');
        showMenu();
      }
    });
  });
}

async function viewJobStats() {
  console.log('\n=== Job Statistics ===');
  
  const queries = [
    {
      title: 'Total Jobs by Status',
      sql: 'SELECT status, COUNT(*) as count FROM jobs GROUP BY status'
    },
    {
      title: 'Jobs by API Key',
      sql: `SELECT ak.description, j.api_key, COUNT(*) as job_count 
            FROM jobs j 
            LEFT JOIN api_keys ak ON j.api_key = ak.key 
            GROUP BY j.api_key`
    },
    {
      title: 'Average Execution Time',
      sql: `SELECT 
              AVG(execution_time_ms) as avg_time,
              MIN(execution_time_ms) as min_time,
              MAX(execution_time_ms) as max_time
            FROM jobs WHERE status = 'done'`
    },
    {
      title: 'Error Statistics',
      sql: `SELECT 
              SUM(crashed) as crashed_count,
              SUM(timed_out) as timeout_count,
              COUNT(*) as total_completed
            FROM jobs WHERE status = 'done'`
    }
  ];
  
  let completed = 0;
  queries.forEach(query => {
    db.all(query.sql, (err, rows) => {
      console.log(`\n${query.title}:`);
      if (err) {
        console.error('Error:', err);
      } else {
        console.table(rows);
      }
      
      completed++;
      if (completed === queries.length) {
        showMenu();
      }
    });
  });
}

async function cleanupOldJobs() {
  const days = await question('\nDelete jobs older than how many days? (enter number): ');
  const daysNum = parseInt(days);
  
  if (isNaN(daysNum) || daysNum < 1) {
    console.log('Invalid input. Please enter a positive number.');
    showMenu();
    return;
  }
  
  db.run(
    `DELETE FROM jobs WHERE created_at < datetime('now', '-${daysNum} days')`,
    function(err) {
      if (err) {
        console.error('Error cleaning up jobs:', err);
      } else {
        console.log(`\n✅ Deleted ${this.changes} jobs older than ${daysNum} days.`);
      }
      showMenu();
    }
  );
}

function showMenu() {
  console.log('\n=== API Key Manager ===');
  console.log('1. List all API keys');
  console.log('2. Create new API key');
  console.log('3. Delete API key');
  console.log('4. View job statistics');
  console.log('5. Cleanup old jobs');
  console.log('6. Exit');
  
  question('\nSelect an option (1-6): ').then(async (choice) => {
    switch(choice) {
      case '1':
        await listApiKeys();
        break;
      case '2':
        await createApiKey();
        break;
      case '3':
        await deleteApiKey();
        break;
      case '4':
        await viewJobStats();
        break;
      case '5':
        await cleanupOldJobs();
        break;
      case '6':
        console.log('Goodbye!');
        process.exit(0);
        break;
      default:
        console.log('Invalid option. Please try again.');
        showMenu();
    }
  });
}

// Initialize database tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      description TEXT
    )
  `);
  
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
  `);
  
  console.log('Docker Java Executor - API Key Manager');
  console.log('======================================');
  console.log(`Database: ${DB_PATH}`);
  
  showMenu();
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n\nClosing database...');
  db.close();
  rl.close();
  process.exit(0);
});