// Duplicate this file as firebase-config.js and fill in your values.
// Set activeFirebaseEnvironment to "production" or "staging".
export const activeFirebaseEnvironment = "staging";

export const firebaseConfigs = {
    production: {
        apiKey: "YOUR_PRODUCTION_API_KEY",
        authDomain: "YOUR_PRODUCTION_AUTH_DOMAIN",
        projectId: "YOUR_PRODUCTION_PROJECT_ID",
        storageBucket: "YOUR_PRODUCTION_STORAGE_BUCKET",
        messagingSenderId: "YOUR_PRODUCTION_MESSAGING_SENDER_ID",
        appId: "YOUR_PRODUCTION_APP_ID",
        measurementId: "YOUR_PRODUCTION_MEASUREMENT_ID"
    },
    staging: {
        apiKey: "YOUR_STAGING_API_KEY",
        authDomain: "YOUR_STAGING_AUTH_DOMAIN",
        projectId: "YOUR_STAGING_PROJECT_ID",
        storageBucket: "YOUR_STAGING_STORAGE_BUCKET",
        messagingSenderId: "YOUR_STAGING_MESSAGING_SENDER_ID",
        appId: "YOUR_STAGING_APP_ID",
        measurementId: "YOUR_STAGING_MEASUREMENT_ID"
    }
};
