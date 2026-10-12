const admin = require("firebase-admin");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const { createGuardedFirestore } = require("./dataGuard");

admin.initializeApp();
const rawDb = admin.firestore();
const db = createGuardedFirestore(rawDb);

module.exports = { admin, db, FieldPath, FieldValue };
