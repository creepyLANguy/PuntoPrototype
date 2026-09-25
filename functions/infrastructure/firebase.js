const admin = require("firebase-admin");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

module.exports = { admin, db, FieldPath, FieldValue };
