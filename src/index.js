const { connectDB, closeDB } = require('./db');
const { startFeedsWatcher, startTasksWatcher } = require('./watcher');

async function bootstrap() {
  const db = await connectDB();

  // Start both watchers in parallel
  startFeedsWatcher(db);
  startTasksWatcher(db);
}

process.on('SIGTERM', async () => {
  await closeDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await closeDB();
  process.exit(0);
});

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error:', err);
  process.exit(1);
});
