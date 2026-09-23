# Firebase environments

This repository now supports two Firebase targets:

- `production` -> value of `FIREBASE_PROJECT_ID_PRODUCTION`
- `staging` -> value of `FIREBASE_PROJECT_ID_STAGING`

`main` deploys to production. Anything not on `main` deploys to staging.

## GitHub Actions configuration

The repository uses a single Firebase deployment workflow at `.github/workflows/deploy.yml`. The workflow contains separate production and staging jobs and deploys both Firebase Hosting and Functions.

Add these repository variables:

- `FIREBASE_PROJECT_ID_PRODUCTION`
- `FIREBASE_PROJECT_ID_STAGING`

Add these repository secrets:

- `FIREBASE_TOKEN_PRODUCTION`
- `FIREBASE_TOKEN_STAGING`
- `FIREBASE_CONFIG_JS_CONTENT_PRODUCTION`
- `FIREBASE_CONFIG_JS_CONTENT_STAGING`

The config secrets must contain the full contents of `app/js/firebase-config.js`, based on `app/js/firebase-config.template.js`.

## Local development

1. Copy `app/js/firebase-config.template.js` to `app/js/firebase-config.js`.
2. Fill in both Firebase config objects.
3. Set `activeFirebaseEnvironment` to:
   - `"staging"` for day-to-day feature testing
   - `"production"` only when you explicitly need live project access
4. Leave `useFirestoreEmulator` set to `false` to use the selected Firebase project from a local host. Set it to `true` only when the Firestore emulator is running locally.

Because `app/js/firebase-config.js` is gitignored, local environment switches stay out of source control.

## Firebase deployment flow

The single `.github/workflows/deploy.yml` workflow runs on pushes that affect application, Functions, Firebase configuration, or deployment workflow files.

### Production

- Pushes to `main` deploy Hosting and Functions to the production Firebase project.
- Production uses `FIREBASE_PROJECT_ID_PRODUCTION` and the corresponding production token/config secrets.

### Staging

- Pushes to non-`main` branches deploy Hosting and Functions to the staging Firebase project.
- Non-`main` branch pushes deploy a 7-day Firebase Hosting preview channel.
- Staging uses `FIREBASE_PROJECT_ID_STAGING` and the corresponding staging token/config secrets.

Preview channels are isolated:

- non-main branch pushes use a stable hashed branch channel in the current deployment workflow.

Reviewers should validate branch-specific changes against the relevant staging preview and staging backend without overwriting production.

The current deployment workflow is triggered by `push` events; opening or updating a pull request by itself does not trigger a deployment.

## Data and auth isolation

Production and staging are separate Firebase projects, so Firestore, Auth, Storage, and Functions stay isolated by project boundary.

If outbound webhook, payment, messaging, or other third-party integrations are added later, make those integrations environment-aware so staging traffic never reaches production services.

If Firebase Analytics is added later, keep staging analytics disabled or send staging traffic to a separate analytics property so test activity does not pollute production reporting.

## Release flow

1. Develop on a feature branch.
2. Validate against the staging preview URL and staging backend.
3. Merge into `main`.
4. The production job in `.github/workflows/deploy.yml` deploys the merged code to the production Firebase project (`FIREBASE_PROJECT_ID_PRODUCTION`).

## Rollback

- Hosting production rollback: use the Firebase Hosting release history in the production Firebase project (`FIREBASE_PROJECT_ID_PRODUCTION`) and roll back to the previous release.
- Hosting staging rollback: redeploy the previous commit to the same preview channel or let the preview channel expire.
- Functions rollback: redeploy the previous known-good commit to the correct Firebase project.

## Rules and indexes

The repository tracks `firestore.rules` and `firestore.indexes.json`. The current Firebase deployment workflow deploys only Hosting and Functions (`--only functions,hosting`). Changes to Firestore rules or indexes are therefore not automatically deployed by this workflow and require an explicit Firestore deployment step when they are ready for release.

Storage rules are not currently tracked in this repository.
