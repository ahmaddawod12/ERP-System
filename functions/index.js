/**
 * I1: Modular Cloud Functions for Smart-Job Application.
 *
 * Domain logic has been split into per-domain modules under ./src/.
 * This file is a thin re-exporter — do NOT add business logic here.
 *
 * Module map:
 *   src/shared.js    — Firebase Admin init, helpers, constants
 *   src/auth.js      — manageWorker, registerBusinessV1
 *   src/jobs.js      — CRUD jobs + Firestore triggers
 *   src/clients.js   — addClientV1, deleteClientV1, updateClientV1
 *   src/documents.js — document generation, preview/generate tasks
 *   src/tax.js       — Tax Authority integration (me-west1)
 *   src/invites.js   — createInviteV1, joinCompanyV1
 *   src/inventory.js — updateInventoryV1
 *   src/profile.js   — profile, push token, cache, business info
 *   src/misc.js      — requestUpgradeV1, contactRequestV1
 */

// Ensure shared module (admin init, global options) runs first
require("./src/shared");

// Re-export all Cloud Function entry points
Object.assign(
  exports,
  require("./src/auth"),
  require("./src/jobs"),
  require("./src/clients"),
  require("./src/documents"),
  require("./src/tax"),
  require("./src/invites"),
  require("./src/inventory"),
  require("./src/profile"),
  require("./src/misc"),
);
