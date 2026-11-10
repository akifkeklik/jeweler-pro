const { spawn } = require('node:child_process');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const child = spawn(process.execPath, ['--test', 'test/salesIntegration.test.js'], {
    cwd: process.cwd(),
    env: { ...process.env, MONGO_URI: replSet.getUri('jeweler_test') },
    stdio: 'inherit',
  });

  child.on('exit', async (code, signal) => {
    await replSet.stop();
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code || 0;
    }
  });
}

main().catch((error) => {
  console.error('Unable to start MongoDB integration test replica set:', error.message);
  process.exitCode = 1;
});
