const { MongoClient, ObjectId } = require('mongodb');

let mongoClient;
let db;

function ts() { return new Date().toISOString(); }

async function connectDB() {
  console.log(`[${ts()}] [DB] Connecting to MongoDB...`);
  mongoClient = new MongoClient(process.env.MONGO_URI);
  await mongoClient.connect();
  db = mongoClient.db(process.env.DB_NAME);
  console.log(`[${ts()}] [DB] Connected to MongoDB — database: ${process.env.DB_NAME}`);
  return db;
}

async function getUserById(userId) {
  return db.collection('users').findOne(
    { _id: new ObjectId(userId.toString()) },
    { projection: { emailId: 1, firstName: 1, lastName: 1, userRole: 1, emailNotifications: 1 } }
  );
}

async function getVisitById(visitId) {
  try {
    return db.collection('patient-visits').findOne(
      { _id: new ObjectId(visitId.toString()) },
      { projection: { patient: 1 } }
    );
  } catch (err) {
    console.warn(`[${ts()}] [DB] getVisitById failed: ${err.message}`);
    return null;
  }
}

async function getPatientById(patientId) {
  try {
    return db.collection('patients').findOne(
      { _id: new ObjectId(patientId.toString()) },
      { projection: { profileId: 1 } }
    );
  } catch (err) {
    console.warn(`[${ts()}] [DB] getPatientById failed: ${err.message}`);
    return null;
  }
}

async function getProjectById(projectId) {
  try {
    return db.collection('projects').findOne(
      { _id: new ObjectId(projectId.toString()) },
      { projection: { protocolId: 1 } }
    );
  } catch (err) {
    console.warn(`[${ts()}] [DB] getProjectById failed: ${err.message}`);
    return null;
  }
}

// Decode MongoDB Binary subType 06 to readable string
function decodeBinary(value) {
  try {
    if (!value) return null;
    if (value._bsontype === 'Binary' || value.buffer) {
      return Buffer.from(value.buffer || value.value()).toString('utf8');
    }
    if (typeof value === 'string') {
      return Buffer.from(value, 'base64').toString('utf8');
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Single function to get both protocolId and profileId from feed metaData
async function getVisitContext(metaData) {
  const result = { profileId: null, protocolId: null };
  if (!metaData) return result;

  // Run both lookups in parallel for performance
  const [projectResult, visitResult] = await Promise.all([
    // Get protocolId from project
    metaData.projectId ? getProjectById(metaData.projectId) : Promise.resolve(null),
    // Get visit for patient lookup
    metaData.visitId ? getVisitById(metaData.visitId) : Promise.resolve(null),
  ]);

  if (projectResult?.protocolId) {
    result.protocolId = projectResult.protocolId;
  }

  if (visitResult?.patient) {
    const patient = await getPatientById(visitResult.patient);
    if (patient?.profileId) {
      result.profileId = decodeBinary(patient.profileId);
    }
  }

  return result;
}

async function closeDB() {
  if (mongoClient) {
    await mongoClient.close();
    console.log(`[${ts()}] [DB] Connection closed.`);
  }
}

module.exports = { connectDB, getUserById, getVisitContext, closeDB };
