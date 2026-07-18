import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import { readArchivesPage } from "../archives/read-repository.js";
import type { DatabaseQueryable } from "../database/runtime.js";

const companyId = "13f75f93-f96a-4873-b889-a7aeab06c333";
const firstId = "3b5cc006-75cb-45cb-b13d-6db90b568e14";
const secondId = "52c18673-0090-4628-8960-524047673d8c";
const thirdId = "5cb6b24c-d028-480b-a7a2-5f50a8013ab6";

function archiveRow(id: string, archiveKey: string, createdAt: string) {
  return {
    id,
    archive_key: archiveKey,
    data_type: "jobs",
    status: "deleted",
    doc_count: 5,
    deleted_count: 5,
    storage_path: `companies/42/archives/${archiveKey}.json`,
    checksum: "a".repeat(64),
    created_at: new Date(createdAt),
    completed_at: new Date(createdAt),
  };
}

test("archive rows normalize pg dates and paginate with the archive UUID", async () => {
  const calls: unknown[][] = [];
  let page = 0;
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>(_text: string, values?: readonly unknown[]) {
      calls.push([...(values ?? [])]);
      page += 1;
      return {
        rowCount: page === 1 ? 3 : 0,
        rows: (page === 1
          ? [
              archiveRow(firstId, "2026-06-j", "2026-07-03T12:00:00.000Z"),
              archiveRow(secondId, "2026-05-j", "2026-07-02T12:00:00.000Z"),
              archiveRow(thirdId, "2026-04-j", "2026-07-01T12:00:00.000Z"),
            ]
          : []) as unknown as Row[],
      };
    },
  };

  const first = await readArchivesPage(transaction, {
    internalCompanyId: companyId,
    pageSize: 2,
  });
  assert.equal(first.items[0]?.createdAt, "2026-07-03T12:00:00.000Z");
  assert.equal(first.items[1]?.completedAt, "2026-07-02T12:00:00.000Z");
  assert.ok(first.nextCursor);

  await readArchivesPage(transaction, {
    internalCompanyId: companyId,
    pageSize: 2,
    cursor: first.nextCursor,
  });
  assert.equal(calls[1]?.[3], "2026-07-02T12:00:00.000Z");
  assert.equal(calls[1]?.[4], secondId);
});

test("archive cursors reject malformed JSON instead of leaking a SyntaxError", async () => {
  const transaction: DatabaseQueryable = {
    async query<Row extends QueryResultRow>() {
      return { rowCount: 0, rows: [] as Row[] };
    },
  };
  const malformed = Buffer.from("not-json", "utf8").toString("base64url");
  await assert.rejects(
    readArchivesPage(transaction, { internalCompanyId: companyId, cursor: malformed }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "INVALID_CURSOR",
  );
});
