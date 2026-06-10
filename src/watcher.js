const { getUserById, getVisitContext } = require('./db');
const { sendFeedEmail, sendTaskEmail } = require('./mailer');

const RECONNECT_DELAY_MS = 5000;

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
      const changeStream = collection.watch(pipeline, { fullDocument: 'updateLookup' });

      log(label, `Listening on ${collectionName} collection...`);

      changeStream.on('change', async (change) => {
        try {
          await onInsert(change.fullDocument);
        } catch (err) {
          error(label, 'Error processing event:', err);
        }
      });

      changeStream.on('error', (err) => {
        error(label, 'Stream error:', err.message);
        changeStream.close();
      });

      changeStream.on('close', () => {
        warn(label, `Stream closed. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
        setTimeout(connect, RECONNECT_DELAY_MS);
      });

    } catch (err) {
      error(label, 'Failed to start stream:', err.message);
      warn(label, `Retrying in ${RECONNECT_DELAY_MS / 1000}s...`);
      setTimeout(connect, RECONNECT_DELAY_MS);
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

      // Fetch visitContext (profileId + protocolId) in parallel with email send prep
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
