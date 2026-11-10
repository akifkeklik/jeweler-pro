/**
 * Runs the whole backend test suite against a real, throw-away MongoDB
 * replica set (transactions require a replica set). Extra CLI arguments are
 * passed to `node --test` (e.g. a single test file).
 *
 * If MONGO_URI is already set, that database is used instead.
 */
const { spawn } = require('node:child_process');

async function main() {
  let replSet = null;
  let mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    mongoUri = replSet.getUri('jeweler_test');
    console.log(`[runTests] In-memory MongoDB replica set: ${mongoUri}`);
  }

  const args = ['--test', '--test-concurrency=1', ...process.argv.slice(2)];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, MONGO_URI: mongoUri },
    stdio: 'inherit',
  });

  child.on('exit', async (code, signal) => {
    if (replSet) await replSet.stop();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code || 0;
  });
}

main().catch((error) => {
  console.error('[runTests] Test MongoDB could not be started:', error.message);
  process.exitCode = 1;
});
