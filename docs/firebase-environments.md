# Firebase environments

This repository uses two Firebase targets:

- production -> FIREBASE_PROJECT_ID_PRODUCTION
- staging -> FIREBASE_PROJECT_ID_STAGING

main deploys to production. Non-main branches deploy to staging.

## GitHub Actions configuration

The repository uses a single Firebase deployment workflow at .github/workflows/deploy.yml. The workflow contains separate production and staging jobs, runs the Functions/Jest + Node integration test suite, and deploys Firebase Hosting and Functions.

Required repository variables:

- FIREBASE_PROJECT_ID_PRODUCTION
- FIREBASE_PROJECT_ID_STAGING

Required repository secrets:

- FIREBASE_TOKEN_PRODUCTION
- FIREBASE_TOKEN_STAGING
- FIREBASE_CONFIG_JS_CONTENT_PRODUCTION
- FIREBASE_CONFIG_JS_CONTENT_STAGING

The config secrets contain the full contents of app/js/firebase-config.js, based on app/js/firebase-config.template.js.

## Local development

1. Copy app/js/firebase-config.template.js to app/js/firebase-config.js.
2. Fill in both Firebase config objects.
3. Use staging for day-to-day feature development.
4. Select production locally only when live-project access is explicitly required.
5. Leave useFirestoreEmulator false when using the selected remote Firebase project. Set it to true only when the emulator is actually running.

Local environment switches remain out of source control because app/js/firebase-config.js is gitignored.

## Deployment flow

The deployment workflow runs on pushes that affect application, Functions, Firebase configuration, or deployment workflow files.

### Production

- A push to main deploys Hosting and Functions to the production Firebase project.
- Production uses FIREBASE_PROJECT_ID_PRODUCTION and the production token/config secrets.

### Staging

- A push to a non-main branch deploys Hosting and Functions to the staging Firebase project.
- Non-main branches also receive a 7-day Firebase Hosting preview channel.
- Staging uses FIREBASE_PROJECT_ID_STAGING and the staging token/config secrets.
- Branch previews are intended for validating the branch against isolated staging data and services.

The workflow is triggered by push events. Opening or updating a pull request by itself does not deploy. Each deployment push runs the Functions/Jest + Node integration test suite before deployment.

## Device Lab environment safety

The Device Lab/harness is admin-gated.

Its environment selection is host-aware:

- production hosts use the production backend;
- qa.padelpush.co.za uses staging;
- locally hosted harness instances intentionally use staging.

The harness presents an explicit production warning and requires an acknowledgement before production mutations are enabled. This is an operational safety control for the test tool, not a substitute for server-side authorization.

Production device testing must use a designated test court and be recorded as an operational test activity rather than being performed against an arbitrary customer court.

## Data and auth isolation

Production and staging are separate Firebase projects, so Firestore, Auth, Storage and Functions are isolated by project boundary.

Third-party integrations introduced later must also be environment-aware so staging traffic cannot reach production services.

## Release flow

1. Develop on a feature branch.
2. Run automated tests.
3. Validate the branch against its staging preview and staging backend.
4. Correct defects and record acceptance evidence.
5. Merge into main.
6. The production job deploys the merged code to the production Firebase project.
7. Run post-deployment smoke checks.

## Rollback

- Hosting production: use Firebase Hosting release history in the production project.
- Hosting staging: redeploy the previous known-good commit to the relevant preview channel or allow the channel to expire.
- Functions: redeploy the previous known-good commit to the correct Firebase project.

## Rules and indexes

The repository tracks firestore.rules and firestore.indexes.json. The current deployment workflow deploys only Hosting and Functions (--only functions,hosting). Changes to Firestore rules or indexes therefore require an explicit Firestore deployment step when ready for release.

The public JSON API paths are redirected by Firebase Hosting to the Johannesburg Cloud Functions because africa-south1 is not a supported direct Firebase Hosting function-rewrite region.

Storage rules are not currently tracked in this repository.
