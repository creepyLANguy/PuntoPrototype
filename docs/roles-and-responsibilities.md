
# Padel Push roles and responsibilities

## 1. Purpose

This document separates organisational responsibility from application permissions.

The role names below are intended to remain useful as the business grows. In an early-stage operation, one person may hold several roles; that is acceptable as long as each responsibility and approval boundary remains explicit.

## 2. Organisational roles

### R01 — Business Owner / Managing Director

Purpose: own overall business outcomes, legal/commercial risk and final business decisions.

Accountable for:
- company strategy, product/business direction and capital allocation;
- approval of material commercial commitments;
- acceptance of material operational, legal, regulatory and security risk;
- appointment of role owners and approval of delegated authority;
- final approval for production release policy and major customer commitments.

Routine technical testing and independent release verification should be performed by another role where staffing permits.

### R02 — Product Owner

Purpose: translate business/customer needs into an ordered, testable product definition.

Responsible for:
- product roadmap and priorities;
- requirements and acceptance criteria;
- current-state product documentation;
- deciding whether a software/hardware change is a product change;
- coordinating application, device and operational impacts.

Authority: accepts/rejects work against the stated product requirement; does not by itself approve legal/compliance exceptions.

### R03 — Platform Engineering Lead

Purpose: own the reliability and technical correctness of the Padel Push software platform.

Responsible for:
- web application;
- Firebase Functions and Firestore architecture;
- public API and contract compatibility;
- CI/CD and environment configuration;
- platform security hardening;
- observability and technical incident response;
- technical review of data-model changes.

Authority: may approve implementation-level technical changes within an accepted product scope; production deployment remains subject to the release process.

### R04 — Hardware & Firmware Engineering Lead

Purpose: own the physical product electronics, embedded firmware and device behaviour.

Responsible for:
- Hub, Beacon and Pulse hardware definitions;
- firmware releases and device protocols;
- hardware/firmware compatibility;
- device diagnostic procedures;
- end-of-line technical tests;
- engineering change control for physical revisions.

Authority: approves firmware/hardware readiness for operations; does not release stock without production/operations controls.

### R05 — Quality & Release Lead

Purpose: verify that releases are fit for deployment and that environments remain separated.

Responsible for:
- release checklists;
- regression and acceptance evidence;
- staging verification;
- production release readiness;
- smoke tests and rollback coordination;
- recording release outcomes.

Authority: may block a release when required acceptance, regression or safety evidence is missing.

### R06 — Operations & Supply Chain Lead

Purpose: move physical products from approved design to controlled inventory and deployment.

Responsible for:
- manufacturers and suppliers;
- procurement and inventory;
- production batches and serialisation;
- provisioning workflow;
- packaging and labels;
- shipping/returns/repair logistics;
- device assignment and retirement records.

Authority: releases physical inventory only when approved production/test status is satisfied.

### R07 — Customer & Club Operations Lead

Purpose: own the operational relationship between Padel Push and the venue/customer.

Responsible for:
- venue onboarding;
- court setup coordination;
- training and operational guidance;
- first-line support;
- incident intake;
- coordinating court/device replacement;
- customer-facing confirmation that a service issue is resolved.

Authority: can execute approved operational procedures but should not make unreviewed changes to platform security or production code.

### R08 — Sales & Partnerships Lead

Purpose: acquire customers, manage pilots and develop commercial partnerships.

Responsible for:
- lead qualification;
- commercial proposals;
- pilots and partner programmes;
- customer requirements capture;
- commercial hand-off to Customer/Club Operations.

Authority: may negotiate within approved commercial policy; material non-standard commitments require Business Owner approval.

### R09 — Finance, Legal & Compliance Lead

Purpose: protect the business from financial, contractual and regulatory exposure.

Responsible for:
- accounting, invoicing and cash controls;
- customer/vendor contracts;
- insurance and corporate records;
- privacy/data-protection obligations;
- regulatory/product compliance coordination;
- review of commercial terms and material supplier/customer liabilities.

### R10 — Marketing & Brand Lead

Purpose: maintain coherent public positioning and market communication.

Responsible for:
- website/product messaging;
- launch and campaign content;
- social channels and brand assets;
- product naming and externally visible claims;
- coordinating customer references and case studies.

## 3. Application and system roles

These are not substitutes for the organisational roles above.

| Application/system role | Current state | Permissions/behaviour |
|---|---|---|
| Platform Admin | Implemented as a privileged app surface | Can access admin dashboard, court/device administration, NFC utility and Device Lab. Current security is application-level and not equivalent to enterprise IAM. |
| Court user / Player | Implemented | Uses a court in play mode and can perform supported scoring actions. |
| Spectator | Implemented | Read-only court experience; scoring controls are disabled/hidden. |
| Broadcast consumer | Implemented as a technical client | Reads public score/revision/stats/momentum endpoints. |
| Hub | Implemented as firmware prototype | Scoring, undo/reset, SPECTATE, REGISTER, NFC parsing, Wi-Fi configuration and factory reset. |
| Beacon | Implemented as firmware prototype | Distance-triggered point input with Team A/B selection and device-originated scoring events. |
| Pulse | Implemented as firmware prototype | Button/tap scoring, hold-to-undo, local team switch and factory reset. |

Important: there is currently no separate software role named Club Admin, Venue Manager, Referee or Support Agent. Those can be organisational responsibilities without being represented as first-class application roles.

## 4. Role authority boundaries

### Business vs product

- Business Owner decides why and how much risk/capital the company takes.
- Product Owner decides what the product should do within approved strategy.
- Engineering decides how the system should implement it.
- Quality/Release decides whether sufficient evidence exists to release it.

### Software vs hardware

- Platform Engineering owns the server/application contract.
- Hardware/Firmware Engineering owns device behaviour and firmware implementation.
- Changes that affect the shared event protocol require joint review.

### Customer operations vs production changes

- Customer Operations owns customer communication and operational remediation.
- Engineering owns code/data remediation.
- No customer-facing role should make ad hoc production code changes.

### Operations vs finance/compliance

- Operations controls stock movement and production records.
- Finance/Compliance controls accounting, contractual and regulatory review.
- High-value procurement, non-standard liabilities and compliance exceptions require Business Owner approval.

## 5. RACI matrix

Legend: A = accountable; R = responsible; C = consulted; I = informed.

| Process | BO | PO | ENG | HW | QA | OPS | CS | COM | FLC |
|---|---|---|---|---|---|---|---|---|---|
| BP-01 Product/change control | A | R | C | C | C | C | C | C | I |
| BP-02 Software release | I | C | R | C | A | I | I | I | C |
| BP-03 Court creation/configuration | I | C | C | I | I | C | A/R | I | I |
| BP-04 Live court operation | I | I | C | C | I | C | A/R | I | I |
| BP-05 Device registration/assignment | I | I | C | C | C | A/R | C | I | I |
| BP-06 Device event ingestion | I | C | A/R | C | C | I | C | I | I |
| BP-07 Beacon changeover | I | C | C | C | I | C | A/R | I | I |
| BP-08 Device validation/diagnostics | I | C | C | A/R | A | C | C | I | I |
| BP-09 Support/incidents | C | C | R | C | C | C | A/R | I | I |
| BP-10 Physical production/provisioning | A | C | C | C | C | R | I | I | C |
| BP-11 Retirement/reassignment | I | I | C | C | C | A/R | C | I | I |
| BP-12 Data/access/security | A | C | R | C | C | C | I | I | A/R |

For BP-02 and BP-08, the Quality & Release Lead should remain independent enough to stop a deployment/build when required evidence is absent. In a very small team this may be a combined role, but the approval step must still be explicit.

## 6. Minimum personnel assignment for an early-stage business

A single founder-led company does not need ten employees on day one. It does need these accountability areas assigned:

1. Business Owner / Managing Director
2. Product Owner
3. Platform Engineering
4. Hardware/Firmware Engineering
5. Operations & Supply Chain
6. Customer/Club Operations
7. Quality & Release
8. Finance/Legal/Compliance

Sales/Partnerships and Marketing can initially be combined with Business Owner/Product or contracted externally.

The key rule is that a person's job title does not remove process boundaries. A founder may simultaneously be BO + PO + Engineering, but the release checklist, production acceptance and financial approval steps still need explicit sign-off.

## 7. Decisions requiring named accountability

The following decisions must always have an identified accountable person, even when delegated execution is distributed:

- product requirement acceptance;
- software production release;
- firmware production release;
- hardware revision release;
- device provisioning method;
- production inventory release;
- customer pilot approval;
- material contract commitment;
- security exception;
- privacy/regulatory exception;
- retirement of a physical device;
- closure of a production incident.
