
# Padel Push business processes

## 1. Purpose

This document defines the operating processes that surround the current Padel Push platform and devices.

It is written to be usable as an operating-model baseline: a person may hold several roles in an early-stage business, but each accountability below remains distinct. Where a process is not yet implemented in software, that fact is called out explicitly rather than being presented as if it already exists.

The current software and firmware repositories establish the following operating baseline:

- PuntoPrototype is the application, Firebase backend, public API, admin portal, NFC utility, Device Lab/harness and deployment workflow.
- ProtoSketches contains the current ESP32 firmware prototypes for Hub, Beacon and Pulse.
- The application is currently court-centric. A court is the active operational container for a match; there is not yet a first-class match/tournament entity.
- Physical manufacturing, production provisioning, inventory control and fulfilment are business processes but are not implemented as an end-to-end system in either repository.

## 2. Current product and actor model

| Actor | Current meaning |
|---|---|
| Platform Admin | Privileged operator of the Padel Push application. Current admin surfaces manage courts and devices and provide access to the NFC utility and Device Lab. |
| Club/Court Operator | Person operating a court or venue. The current product does not yet implement a distinct RBAC role for this person; access is primarily court/password based. |
| Player | Participant using the scoring app or physical scoring device during a live court session. |
| Spectator | Read-only participant consuming a court view or public scoreboard. |
| Broadcast/Integration Consumer | OBS or another system consuming the public score/revision/stats/momentum endpoints. |
| Device | System actor representing Hub, Beacon or Pulse firmware. |
| Business role | An organisational responsibility such as Product Owner, Platform Engineering or Operations. These are distinct from application roles. |

## 3. Process catalogue

| ID | Process | Trigger | Primary accountable role | Current system of record |
|---|---|---|---|---|
| BP-01 | Product and change control | New requirement, defect, hardware change or policy decision | Product Owner | Git/GitHub + product documentation |
| BP-02 | Software release and environment promotion | Approved software change | Quality & Release Lead | GitHub + Firebase staging/production |
| BP-03 | Court creation and configuration | New court required | Customer/Club Operations | Firestore courts collection |
| BP-04 | Live court operation and scoring | Match/session starts | Club/Court Operator | Firestore event stream + live score |
| BP-05 | Device registration and assignment | New device introduced or moved | Operations / Platform Admin | Firestore devices collection |
| BP-06 | Device event ingestion | Physical device action | Platform Engineering | postEvent + court event stream |
| BP-07 | Beacon court changeover | Physical court-side changeover | Club/Court Operator / Platform Admin | Court Beacon mapping + changeover marker |
| BP-08 | Device validation and diagnostic testing | Development, repair, acceptance or incident | Hardware/Firmware Engineering | Device Lab + test records |
| BP-09 | Customer support and incident handling | Fault report, scoring issue, device issue or service interruption | Customer/Club Operations | Support record + linked technical issue |
| BP-10 | Physical production and provisioning | Approved hardware build | Operations / Supply Chain | Production records outside repo |
| BP-11 | Device retirement, replacement and reassignment | Lost, damaged, failed or replaced device | Operations / Platform Admin | Device record + production/support records |
| BP-12 | Data, access and security administration | Role change, security incident, privacy request or audit | Business Owner + Platform Engineering + Compliance | Access records + incident records |

## 4. Detailed process definitions

### BP-01 — Product and change control

Purpose: ensure product, software and hardware changes are deliberate, traceable and accepted by the accountable owner.

Inputs: customer feedback, defects, feature requests, hardware findings, operational incidents, regulatory/compliance requirements.

Steps:
1. Record the change as a discrete work item.
2. Product Owner defines intended outcome and acceptance criteria.
3. Engineering identifies affected application, API, data, firmware, hardware and operational processes.
4. Quality/Release identifies regression, deployment and rollback requirements.
5. Hardware/Operations identify physical-production consequences where relevant.
6. Product Owner approves scope for implementation.
7. Implementation is completed on a branch with documentation updated in the same change.
8. Change is tested in staging before production release.
9. Production release is approved through the release process.

Outputs: approved implementation, updated documentation, test evidence, release decision and traceable Git history.

Controls: API/schema changes require API documentation and contract tests; hardware changes require revision-controlled production information before a production build.

### BP-02 — Software release and environment promotion

Purpose: keep staging and production changes separated and make production changes reproducible.

Current environment rule:
- main -> production Firebase project and production site.
- non-main branches -> staging Firebase project and branch preview.
- local hosted development -> staging by default.
- Device Lab production mutations require a separate explicit production acknowledgement.

Steps:
1. Develop on a feature branch.
2. Run automated tests and repository checks.
3. Deploy branch to staging/preview.
4. Validate application, functions, device ingestion and affected operational flows.
5. Record any defects and resolve them before release.
6. Merge approved changes to main.
7. Production deployment runs through the repository deployment workflow.
8. Perform post-release smoke checks.
9. Roll back to the previous known-good revision when materially faulty.

Controls: production is never the default local target; the Device Lab presents an explicit production mutation warning and acknowledgement.

### BP-03 — Court creation and configuration

Purpose: create a court operational container and establish its scoring configuration.

Steps:
1. Platform Admin or authorised operational user creates the court.
2. Assign court name/identifier and access password requirements.
3. Set team/player names and scoring mode/options.
4. Confirm initial scoreVersion and default Beacon mapping.
5. Confirm the court is in the correct status: open, private or closed.
6. Perform a basic score/display check before the court is handed to the venue.

Outputs: usable court record, live score state and known access configuration.

Important current limitation: the software does not yet provide a dedicated Club Operator RBAC role. Authorisation for privileged callable functions is also not yet enforced by explicit request.auth checks.

### BP-04 — Live court operation and scoring

Purpose: run a live scoring session with a single authoritative event stream.

Steps:
1. Court is opened/configured.
2. Players join the court in play mode, or a spectator joins in spectate mode.
3. Scoring input comes from the web app or a physical device.
4. Device actions are sent to postEvent; browser actions can write scoring events directly.
5. courts/{courtId}/events/{eventId} is appended.
6. onEventCreate applies/replays scoring logic.
7. score/current is updated for live clients.
8. Public score/revision/stats/momentum endpoints expose read-only outputs.
9. RESET starts a new score version and archives the prior active event stream.

Outputs: live scoreboard, event history, optional broadcast data and reset archive.

### BP-05 — Device registration and assignment

Purpose: place a known device onto a specific court and keep the device-to-court relationship explicit.

Current device families: Hub, Beacon, Pulse.

Steps:
1. Operations receives/identifies the physical device.
2. Assign or confirm deviceId and device family.
3. Bind the device to a court using current device tooling or the Hub REGISTER flow.
4. Verify the binding in the admin device list.
5. Run a controlled scoring/operational test.
6. Record the deployment/assignment in the operational device register outside the repository where appropriate.

Current implementation: devices/{deviceId} stores the current court binding; the current device protocol does not yet provide cryptographic device identity.

### BP-06 — Device event ingestion

Purpose: convert physical actions into authoritative scoring/operational events.

Current event classes: POINT_TEAM_A, POINT_TEAM_B, UNDO, RESET, SPECTATE, REGISTER.

Steps:
1. Device creates an event request.
2. postEvent validates the device ID and event type.
3. Device binding is resolved.
4. For Beacon scoring events, the server applies the current court beaconSidesSwapped mapping.
5. Effective event is appended to the court event stream.
6. Event trigger updates the derived score.

Current limitation: HMAC authentication, freshness checks, nonce handling and client-generated idempotency keys are documented targets, not implemented runtime controls.

### BP-07 — Beacon court changeover

Purpose: keep physical Beacon-side semantics aligned with the logical Team A/Team B scoreboard after a court-side changeover.

Steps:
1. Operator confirms the court has changed sides.
2. Operator uses the court Changeover control.
3. changeoverCourt sets beaconSidesSwapped to true or false.
4. The court stores a changeoverEvent marker.
5. Subsequent Beacon scoring events are mapped using the active flag.
6. Pulse events are not inverted by the Beacon mapping.
7. RESET clears the mapping to the default false state for the next match/session.

Control: do not interpret a changeover as rewriting already-recorded scoring events; it only changes how new Beacon input is interpreted.

### BP-08 — Device validation and diagnostic testing

Purpose: test physical-device workflows without uncontrolled production mutation.

Current tools: Device Lab/harness in PuntoPrototype; source firmware in ProtoSketches.

Steps:
1. Authenticate into the Device Lab.
2. Select/create a virtual device using a known SKU.
3. Prefer local/staging environments for development and diagnosis.
4. Test device-specific actions.
5. Verify request/response and resulting court state.
6. For production testing, explicitly acknowledge the production mutation warning and use a designated test court.
7. Record failures as engineering issues rather than modifying production data ad hoc.

Device-specific focus:
- Hub: point, undo, reset, spectate, register, NFC actions, Wi-Fi configuration and local factory reset.
- Beacon: distance detection, team selection, debounce/hysteresis, point events and Wi-Fi behaviour.
- Pulse: tap scoring, hold-to-undo, local team switch and factory reset.

### BP-09 — Customer support and incident handling

Purpose: resolve customer-visible problems while preserving the technical evidence needed for diagnosis.

Steps:
1. Customer Operations captures venue, court ID, time, device ID/SKU and observed behaviour.
2. Determine whether the problem is scoring, network/device, account/access, display/integration or service-wide.
3. Avoid destructive remediation until the event history and current state have been inspected.
4. Escalate to Platform Engineering or Hardware/Firmware Engineering with a reproducible description.
5. Apply the least-invasive correction.
6. Confirm recovery with the customer.
7. Record root cause and any required product/process change.

Control: production event history is evidence; do not manually fix historical scoring by altering the source history.

### BP-10 — Physical production and provisioning

Purpose: produce deployable devices with controlled hardware/software identity.

Current repository boundary: this process is not implemented end-to-end in PuntoPrototype or ProtoSketches.

Required business steps:
1. Approve hardware revision and production BOM.
2. Approve PCB/Gerbers and enclosure revision.
3. Approve firmware release.
4. Generate/assign device identity.
5. Provision credentials/keys under a controlled process.
6. Run end-of-line functional tests.
7. Capture serial/device/SKU/revision records.
8. Package, label and release inventory.
9. Assign device to stock, customer order or deployment batch.
10. Maintain traceability for returns, repairs and retirement.

Control: no production unit should leave controlled ownership without a recorded identity, hardware revision, firmware revision and test status.

### BP-11 — Device retirement, replacement and reassignment

Trigger: device lost, damaged, replaced, returned or permanently removed.

Steps:
1. Mark device as unavailable for new deployment.
2. Identify its last known court/customer assignment.
3. Remove or change the court binding as appropriate.
4. Preserve operational history required for support/audit.
5. Repair/reflash/reprovision or retire the hardware.
6. Record the new device identity when a replacement is issued.

### BP-12 — Data, access and security administration

Current application boundary:
- Public read endpoints are intentionally unauthenticated.
- Admin access is an application-level privileged surface.
- Current callable functions do not perform explicit request.auth checks.
- Firestore Admin SDK writes bypass Firestore rules.
- The repository's Firestore rules are documented as emulator-only.

Required organisational controls:
1. Assign privileged access only to named personnel.
2. Review privileged access whenever personnel change.
3. Keep production testing separate from normal development.
4. Do not store device secrets in source control, URLs, NFC data or logs.
5. Record security incidents and credential/provisioning changes.
6. Treat production-hardening items in device-protocol.md as release-blocking work before broad physical-device deployment.

## 5. Process hand-offs

The following hand-offs must have a named accountable owner:

- Product Owner -> Engineering: accepted requirement and acceptance criteria.
- Engineering -> Quality/Release: tested change and release notes.
- Quality/Release -> Business Owner/Product Owner: release recommendation.
- Operations -> Customer Operations: verified device and deployment record.
- Customer Operations -> Engineering: reproducible incident with court/device context.
- Hardware/Firmware -> Operations: released firmware/hardware revision plus test evidence.
- Operations -> Customer/Club: commissioned device with known ID/SKU and assignment.
- Business Owner/Compliance -> Engineering/Operations: approved handling of security, privacy and regulatory requirements.

## 6. Current-state gaps that must not be mistaken for implemented controls

The following are deliberately recorded as gaps:

- No first-class match/tournament entity or matchId.
- No complete application RBAC model for business roles.
- No explicit callable request.auth authorisation enforcement.
- No cryptographic device authentication, freshness/replay protection or device-side idempotency.
- No end-to-end manufacturing/provisioning/inventory system in the repositories.
- No dedicated production telemetry/correlation layer.
- Firestore rules/indexes are tracked but are not deployed by the current CI workflow.
