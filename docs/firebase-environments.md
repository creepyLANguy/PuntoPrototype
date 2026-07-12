# Firebase environments

This repository now supports two Firebase targets:

- `production` -> `punto-8888`
- `staging` -> `punto-8888-staging`

`main` deploys to production. Anything not on `main` deploys to staging.

## GitHub Actions configuration

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

Because `app/js/firebase-config.js` is gitignored, local environment switches stay out of source control.

## Hosting deployment flow

- Push to `main` -> deploys Hosting to the production Firebase project.
- Push to any other branch -> deploys a 7-day Firebase Hosting preview channel in the staging Firebase project.
- Open or update a pull request -> refreshes the staging preview and comments the preview URL on the PR.

Preview channels are isolated:

- pull requests use `pr-<number>`
- non-main branch pushes use a stable hashed branch channel

This lets reviewers test branch-specific changes without overwriting production Hosting.

## Functions deployment flow

- Pushes to `main` deploy Functions to the production Firebase project.
- Pushes to non-main branches deploy Functions to the shared staging Firebase project.

This keeps production callable functions tied to `main` while allowing feature work to exercise the staging backend.

## Data and auth isolation

Production and staging are separate Firebase projects, so Firestore, Auth, Storage, and Functions stay isolated by project boundary.

If outbound webhook, payment, messaging, or other third-party integrations are added later, make their routing environment-aware so staging traffic never reaches production services.

If Firebase Analytics is added later, keep staging analytics disabled or send staging traffic to a separate analytics property so test activity does not pollute production reporting.

## Release flow

1. Develop on a feature branch.
2. Validate against the staging preview URL and staging backend.
3. Merge into `main`.
4. Let the production Hosting and Functions workflows deploy the merged code to `punto-8888`.

## Rollback

- Hosting production rollback: use the Firebase Hosting release history in the `punto-8888` project and roll back to the previous release.
- Hosting staging rollback: redeploy the previous commit to the same preview channel or let the preview channel expire.
- Functions rollback: redeploy the previous known-good commit to the correct Firebase project.

## Rules and indexes

There are currently no tracked Firestore rules, Storage rules, or Firestore index files in this repository. If those files are added later, include them in both production and staging deployment workflows so environment protections stay aligned.
