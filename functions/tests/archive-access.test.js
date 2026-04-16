const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildArchiveStoragePath,
  filterArchiveItemsForRole,
  normalizeArchiveMonthInput,
  parseArchivePayload,
} = require("../src/archive-access");

test("normalizeArchiveMonthInput accepts canonical archive inputs", () => {
  assert.deepEqual(normalizeArchiveMonthInput("2026", "4", "finishedJobs"), {
    year: 2026,
    month: 4,
    dataType: "finishedJobs",
    archiveKey: "2026-4-j",
  });
  assert.equal(
    buildArchiveStoragePath("acme", "2026-4-d"),
    "companies/acme/archives/2026-4-d.json",
  );
});

test("parseArchivePayload requires a JSON array", () => {
  assert.deepEqual(parseArchivePayload('[{"id":"1"}]', "2026-4-d"), [{ id: "1" }]);
  assert.throws(
    () => parseArchivePayload('{"id":"1"}', "2026-4-d"),
    /JSON array/,
  );
});

test("filterArchiveItemsForRole scopes archived jobs and documents for non-managers", () => {
  const archivedJobs = [
    { id: "1", wid: "7" },
    { id: "2", wid: "9" },
  ];
  const archivedDocuments = [
    { id: "d1", createdByUid: "user-1" },
    { id: "d2", createdByUid: "user-2" },
  ];

  assert.deepEqual(
    filterArchiveItemsForRole(archivedJobs, "finishedJobs", "worker", { uid: "user-1", wid: 7 }),
    [{ id: "1", wid: "7" }],
  );
  assert.deepEqual(
    filterArchiveItemsForRole(archivedDocuments, "documents", "user", { uid: "user-1" }),
    [{ id: "d1", createdByUid: "user-1" }],
  );
  assert.deepEqual(
    filterArchiveItemsForRole(archivedJobs, "finishedJobs", "manager", { uid: "manager-1", wid: 1 }),
    archivedJobs,
  );
});
