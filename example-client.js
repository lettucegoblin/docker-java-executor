const axios = require('axios');

// Configuration
const SERVER_URL = 'http://localhost:3000';
const API_KEY = 'test-api-key-123';

// Helper function to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Example 1: Simple Hello World
async function example1() {
  console.log('\n=== Example 1: Simple Hello World ===');
  
  const javaCode = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Docker!");
        System.out.println("Java Version: " + System.getProperty("java.version"));
    }
}`;

  try {
    // Submit job
    const submitResponse = await axios.post(
      `${SERVER_URL}/api/submit`,
      { javaCode },
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    const jobId = submitResponse.data.jobId;
    console.log(`Job submitted: ${jobId}`);
    
    // Poll for results
    let result = null;
    let attempts = 0;
    while (attempts < 20) {
      const statusResponse = await axios.get(
        `${SERVER_URL}/api/job/${jobId}`,
        { headers: { 'X-API-Key': API_KEY } }
      );
      
      console.log(`Status: ${statusResponse.data.status}`);
      
      if (statusResponse.data.status === 'done') {
        result = statusResponse.data.result;
        break;
      }
      
      await sleep(500);
      attempts++;
    }
    
    if (result) {
      console.log('Output:', result.stdout);
      console.log('Execution time:', result.executionTimeMs, 'ms');
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Example 2: With Command Line Arguments
async function example2() {
  console.log('\n=== Example 2: With Arguments ===');
  
  const javaCode = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Number of arguments: " + args.length);
        for (int i = 0; i < args.length; i++) {
            System.out.println("Arg " + i + ": " + args[i]);
        }
    }
}`;

  try {
    const submitResponse = await axios.post(
      `${SERVER_URL}/api/submit`,
      { 
        javaCode,
        args: ['first', 'second', 'third argument with spaces']
      },
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    const jobId = submitResponse.data.jobId;
    console.log(`Job submitted: ${jobId}`);
    
    // Poll and get results
    await pollForResults(jobId);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Example 3: With Input Files
async function example3() {
  console.log('\n=== Example 3: With Input Files ===');
  
  const javaCode = `
import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) {
        try {
            // Read numbers from file
            Scanner sc = new Scanner(new File("numbers.txt"));
            int sum = 0;
            int count = 0;
            
            while (sc.hasNextInt()) {
                sum += sc.nextInt();
                count++;
            }
            sc.close();
            
            System.out.println("Numbers read: " + count);
            System.out.println("Sum: " + sum);
            System.out.println("Average: " + (count > 0 ? (double)sum/count : 0));
            
            // Read config file
            Properties props = new Properties();
            props.load(new FileInputStream("config.properties"));
            System.out.println("Config loaded:");
            props.forEach((k, v) -> System.out.println("  " + k + " = " + v));
            
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            e.printStackTrace();
        }
    }
}`;

  try {
    const submitResponse = await axios.post(
      `${SERVER_URL}/api/submit`,
      { 
        javaCode,
        inputFiles: [
          {
            name: 'numbers.txt',
            content: '10 20 30 40 50'
          },
          {
            name: 'config.properties',
            content: 'app.name=TestApp\napp.version=1.0.0\napp.debug=true'
          }
        ]
      },
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    const jobId = submitResponse.data.jobId;
    console.log(`Job submitted: ${jobId}`);
    
    await pollForResults(jobId);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Example 4: Resource Intensive (will show memory/CPU usage)
async function example4() {
  console.log('\n=== Example 4: Resource Monitoring ===');
  
  const javaCode = `
import java.util.*;

public class Main {
    public static void main(String[] args) {
        // Allocate some memory
        List<byte[]> memoryList = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            memoryList.add(new byte[1024 * 1024]); // 1MB blocks
        }
        
        // Do some CPU-intensive work
        long sum = 0;
        for (long i = 0; i < 100_000_000L; i++) {
            sum += i;
        }
        
        System.out.println("Sum calculated: " + sum);
        System.out.println("Memory blocks allocated: " + memoryList.size());
        System.out.println("Done!");
    }
}`;

  try {
    const submitResponse = await axios.post(
      `${SERVER_URL}/api/submit`,
      { javaCode },
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    const jobId = submitResponse.data.jobId;
    console.log(`Job submitted: ${jobId}`);
    
    const result = await pollForResults(jobId);
    if (result) {
      console.log(`Memory used: ${result.memoryUsageMB?.toFixed(2)} MB`);
      console.log(`Peak CPU: ${result.cpuPercentMax?.toFixed(2)}%`);
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Example 5: Timeout Test (will be terminated)
async function example5() {
  console.log('\n=== Example 5: Timeout Test (will timeout after 10s) ===');
  
  const javaCode = `
public class Main {
    public static void main(String[] args) throws InterruptedException {
        System.out.println("Starting long-running task...");
        for (int i = 1; i <= 20; i++) {
            System.out.println("Working... " + i + " seconds");
            Thread.sleep(1000);
        }
        System.out.println("This won't be printed due to timeout");
    }
}`;

  try {
    const submitResponse = await axios.post(
      `${SERVER_URL}/api/submit`,
      { javaCode },
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    const jobId = submitResponse.data.jobId;
    console.log(`Job submitted: ${jobId}`);
    
    const result = await pollForResults(jobId, 15000); // Wait longer for timeout
    if (result) {
      console.log('Timed out:', result.timedOut);
      console.log('Output before timeout:', result.stdout);
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Helper function to poll for results
async function pollForResults(jobId, maxWaitMs = 10000) {
  const pollInterval = 500;
  const maxAttempts = maxWaitMs / pollInterval;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const statusResponse = await axios.get(
      `${SERVER_URL}/api/job/${jobId}`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    if (statusResponse.data.status === 'done') {
      const result = statusResponse.data.result;
      console.log('\nResults:');
      console.log('--------');
      if (result.stdout) console.log('Output:', result.stdout);
      if (result.stderr) console.log('Errors:', result.stderr);
      console.log('Crashed:', result.crashed);
      console.log('Timed out:', result.timedOut);
      console.log('Execution time:', result.executionTimeMs, 'ms');
      return result;
    }
    
    await sleep(pollInterval);
    attempts++;
  }
  
  console.log('Polling timeout - job still running');
  return null;
}

// Example 6: List all jobs
async function example6() {
  console.log('\n=== Example 6: List All Jobs ===');
  
  try {
    const response = await axios.get(
      `${SERVER_URL}/api/jobs?limit=5`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    
    console.log(`Found ${response.data.jobs.length} jobs:`);
    response.data.jobs.forEach(job => {
      console.log(`- ${job.id}: ${job.status} (${new Date(job.created_at).toLocaleString()})`);
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Main execution
async function main() {
  console.log('Docker Java Executor - Example Client');
  console.log('=====================================');
  
  // Check server health first
  try {
    const health = await axios.get(`${SERVER_URL}/health`);
    console.log('Server status:', health.data.status);
  } catch (error) {
    console.error('Server is not running! Start it with: npm start');
    process.exit(1);
  }
  
  // Run examples
  await example1(); // Simple Hello World
  await example2(); // With arguments
  await example3(); // With input files
  await example4(); // Resource monitoring
  await example5(); // Timeout test
  await example6(); // List jobs
  
  console.log('\n=== All examples completed ===');
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { pollForResults };