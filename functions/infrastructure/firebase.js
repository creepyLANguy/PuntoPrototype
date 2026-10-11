const admin = require("firebase-admin");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const { createGuardedFirestore } = require("./dataGuard");

admin.initializeApp();
// rawDb is reserved for the ID retention worker (runs under the maintenance
// gate); every other backend write goes through the guarded singleton.
const rawDb = admin.firestore();
const db = createGuardedFirestore(rawDb);

module.exports = { admin, db, rawDb, FieldPath, FieldValue };
