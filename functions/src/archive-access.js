const { HttpsError } = require("firebase-functions/v2/https");

const ARCHIVE_DATA_TYPES = {
  finishedJobs: "j",
  documents: "d",
};

function normalizeArchiveMonthInput(year, month, dataType) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedType = typeof dataType === "string" ? dataType.trim() : "";
  const suffix = ARCHIVE_DATA_TYPES[normalizedType];

  if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 2100) {
    throw new HttpsError("invalid-argument", "year is invalid");
  }
  if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) {
    throw new HttpsError("invalid-argument", "month is invalid");
  }
  if (!suffix) {
    throw new HttpsError("invalid-argument", "dataType must be finishedJobs or documents");
  }

  return {
    year: normalizedYear,
    month: normalizedMonth,
    dataType: normalizedType,
    archiveKey: `${normalizedYear}-${normalizedMonth}-${suffix}`,
  };
}

function buildArchiveStoragePath(companyId, archiveKey) {
  return `companies/${companyId}/archives/${archiveKey}.json`;
}

function parseArchivePayload(contents, archiveKey) {
  let parsed;
  try {
    parsed = JSON.parse(String(contents || ""));
  } catch (_error) {
    throw new HttpsError("internal", `Archive ${archiveKey} is not valid JSON`);
  }

  if (!Array.isArray(parsed)) {
    throw new HttpsError("internal", `Archive ${archiveKey} payload must be a JSON array`);
  }

  return parsed;
}

function filterArchiveItemsForRole(items, dataType, resolvedRole, profile) {
  if (resolvedRole === "manager" || resolvedRole === "dev") {
    return items;
  }

  if (dataType === "finishedJobs") {
    const wid = String(profile?.wid || "").trim();
    if (!wid) return [];
    return items.filter((item) => String(item?.wid || "") === wid);
  }

  const uid = String(profile?.uid || "").trim();
  if (!uid) return [];
  return items.filter((item) => String(item?.createdByUid || "") === uid);
}

module.exports = {
  buildArchiveStoragePath,
  filterArchiveItemsForRole,
  normalizeArchiveMonthInput,
  parseArchivePayload,
};
