const { getUserById, getVisitContext } = require('./db');
const { sendFeedEmail, sendTaskEmail } = require('./mailer');

const RECONNECT_DELAY_MS = 5000;

// In-memory resume token store per collection
const resumeTokens = {};

// Processing lock — prevents same document being processed twice (race condition)
const processingLocks = new Set();

function log(label, msg) {
  console.log(`[${new Date().toISOString()}] [${label}] ${msg}`);
}
function warn(label, msg) {
  console.warn(`[${new Date().toISOString()}] [${label}] ${msg}`);
}
function error(label, msg, err) {
  console.error(`[${new Date().toISOString()}] [${label}] ${msg}`, err || '');
}

async function watchCollection({ db, collectionName, pipeline, label, onInsert }) {
  const connect = async () => {
    try {
      const collection = db.collection(collectionName);

      // Resume from last known position if available
      const options = { fullDocument: 'updateLookup' };
      if (resumeTokens[collectionName]) {
        options.resumeAfter = resumeTokens[collectionName];
        log(label, `Resuming from token: ${JSON.stringify(resumeTokens[collectionName])}`);
      } else {
        // Start from now — don't replay old events on first start
        options.startAtOperationTime = new Date();
        log(label, `Starting from current time (no resume token)`);
      }

      const changeStream = collection.watch(pipeline, options);

      log(label, `Listening on ${collectionName} collection...`);

      changeStream.on('change', async (change) => {
        const docId = change.fullDocument?._id?.toString();

        // Skip if already being processed (race condition guard)
        if (docId && processingLocks.has(docId)) {
          warn(label, `Duplicate event detected for docId: ${docId} — skipping`);
          return;
        }

        if (docId) processingLocks.add(docId);

        try {
          // Save resume token before processing
          resumeTokens[collectionName] = change._id;
          await onInsert(change.fullDocument);
        } catch (err) {
          error(label, 'Error processing event:', err);
        } finally {
          // Always release lock after processing
          if (docId) processingLocks.delete(docId);
        }
      });

      changeStream.on('error', (err) => {
        error(label, 'Stream error:', err.message);
        process.exit(1);
      });

      changeStream.on('close', () => {
        warn(label, `Stream closed. Exiting for clean Kubernetes restart...`);
        process.exit(1);
      });

    } catch (err) {
      error(label, 'Failed to start stream:', err.message);
      process.exit(1);
    }
  };

  await connect();
}

// ─── Feeds watcher ────────────────────────────────────────────────────────────
async function startFeedsWatcher(db) {
  await watchCollection({
    db,
    collectionName: 'feeds',
    pipeline: [{ $match: { operationType: 'insert' } }],
    label: 'Feeds',
    onInsert: async (doc) => {
      if (!doc || !doc.userId) return;

      const user = await getUserById(doc.userId);
      if (!user || !user.emailId) {
        warn('Feeds', `No email for userId: ${doc.userId}`);
        return;
      }

      if (user.userRole && user.userRole.trim().toLowerCase() === 'admin') {
        log('Feeds', `Skipping Admin: ${user.emailId}`);
        return;
      }

      if (user.emailNotifications === false) {
        log('Feeds', `Skipping unsubscribed user: ${user.emailId}`);
        return;
      }

      const visitContext = await getVisitContext(doc.metaData);
      log('Feeds', `Visit context — protocolId: ${visitContext.protocolId} | profileId: ${visitContext.profileId}`);

      await sendFeedEmail(user.emailId, user.firstName, doc, visitContext);
    },
  });
}

// ─── Tasks watcher ────────────────────────────────────────────────────────────
async function startTasksWatcher(db) {
  await watchCollection({
    db,
    collectionName: 'tasks',
    pipeline: [{
      $match: {
        operationType: 'insert',
        'fullDocument.message': { $regex: 'Activate', $options: 'i' }
      }
    }],
    label: 'Tasks',
    onInsert: async (doc) => {
      if (!doc || !doc.userId) return;

      const user = await getUserById(doc.userId);
      if (!user || !user.emailId) {
        warn('Tasks', `No email for userId: ${doc.userId}`);
        return;
      }

      await sendTaskEmail(user.emailId, user.firstName, doc);
    },
  });
}

module.exports = { startFeedsWatcher, startTasksWatcher };
