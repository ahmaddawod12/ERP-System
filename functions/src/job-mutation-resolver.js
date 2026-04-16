class JobMutationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JobMutationError';
    this.code = code;
  }
}

const BASE_JOB_FIELDS = [
  'title', 'description', 'notes', 'location', 'address',
  'category', 'priority', 'dueDate', 'tags', 'images',
  'parts', 'partsUsed',
  'timeFrom', 'timeTo', 'travelDistance',
  'signingPerson', 'photos', 'signature',
  'finishedAt',
];

const ARRAY_FIELDS = ['parts', 'partsUsed', 'images', 'photos', 'tags'];

function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

function normalizeId(value) {
  const normalized = String(value ?? '').trim();
  return normalized || '';
}

function trimOptional(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStoragePath(path) {
  const normalized = trimOptional(path).replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('?')) {
    return '';
  }
  return normalized;
}

function extractStoragePathFromUrl(rawValue) {
  const raw = trimOptional(rawValue);
  if (!raw) return '';

  if (raw.startsWith('gs://')) {
    const withoutScheme = raw.slice(5);
    const firstSlash = withoutScheme.indexOf('/');
    return firstSlash >= 0 ? normalizeStoragePath(withoutScheme.slice(firstSlash + 1)) : '';
  }

  try {
    const parsed = new URL(raw);

    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const marker = '/o/';
      const index = parsed.pathname.indexOf(marker);
      if (index < 0) return '';
      return normalizeStoragePath(decodeURIComponent(parsed.pathname.slice(index + marker.length)));
    }

    if (parsed.hostname === 'storage.googleapis.com') {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) return '';
      return normalizeStoragePath(pathParts.slice(1).join('/'));
    }
  } catch {
    return '';
  }

  return '';
}

function assertCanonicalJobFilePath(storagePath, fieldName, expected = {}) {
  const parts = String(storagePath || '').split('/');
  if (parts.length < 4 || parts[1] !== 'jobs') {
    throw new JobMutationError('invalid-argument', `${fieldName} must point to a job file path`);
  }
  if (expected.jobId && parts[2] !== String(expected.jobId)) {
    throw new JobMutationError('invalid-argument', `${fieldName} storagePath must match the job id`);
  }
  if (expected.ownerUid && parts[0] !== String(expected.ownerUid)) {
    throw new JobMutationError('permission-denied', `${fieldName} storagePath owner does not match the caller`);
  }
}

function normalizeJobFileRef(value, fieldName, expected = {}) {
  if (value == null) return null;

  if (typeof value === 'object' && !Array.isArray(value)) {
    const storagePath = normalizeStoragePath(value.storagePath);
    if (!storagePath) {
      throw new JobMutationError('invalid-argument', `${fieldName} must include a valid storagePath`);
    }
    assertCanonicalJobFilePath(storagePath, fieldName, expected);
    return { storagePath };
  }

  if (typeof value === 'string') {
    const storagePath = extractStoragePathFromUrl(value);
    if (!storagePath) {
      throw new JobMutationError(
        'invalid-argument',
        `${fieldName} must use canonical storagePath refs, not local or durable URLs`,
      );
    }
    assertCanonicalJobFilePath(storagePath, fieldName, expected);
    return { storagePath };
  }

  throw new JobMutationError('invalid-argument', `${fieldName} must be a storage ref object or URL string`);
}

function sanitizeJobFileFields(payload, expected = {}) {
  if (hasOwn(payload, 'photos')) {
    if (!Array.isArray(payload.photos)) {
      throw new JobMutationError('invalid-argument', 'photos must be an array');
    }
    payload.photos = payload.photos.map((photo, index) => normalizeJobFileRef(photo, `photos[${index}]`, expected));
  }

  if (hasOwn(payload, 'signature')) {
    if (payload.signature == null || (typeof payload.signature === 'string' && trimOptional(payload.signature) === '')) {
      payload.signature = null;
    } else {
      payload.signature = normalizeJobFileRef(payload.signature, 'signature', expected);
    }
  }
}

function pickMutableFields(input) {
  const payload = {};
  for (const key of BASE_JOB_FIELDS) {
    if (hasOwn(input, key) && input[key] !== undefined) {
      payload[key] = input[key];
    }
  }
  return payload;
}

function validateArrayLengths(payload, maxArrayLength) {
  for (const field of ARRAY_FIELDS) {
    if (Array.isArray(payload[field]) && payload[field].length > maxArrayLength) {
      throw new JobMutationError('invalid-argument', `${field} exceeds maximum length (${maxArrayLength})`);
    }
  }
}

function validateInventoryPartList(payload, fieldName) {
  if (!hasOwn(payload, fieldName)) return;
  const value = payload[fieldName];
  if (!Array.isArray(value)) {
    throw new JobMutationError('invalid-argument', `${fieldName} must be an array`);
  }
  payload[fieldName] = value.map((part, index) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      throw new JobMutationError('invalid-argument', `${fieldName}[${index}] must be an object`);
    }
    const quantity = Number(part.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new JobMutationError('invalid-argument', `${fieldName}[${index}].quantity must be a non-negative finite number`);
    }
    const id = part.id;
    if (id === undefined || id === null || String(id).trim() === '') {
      throw new JobMutationError('invalid-argument', `${fieldName}[${index}].id is required`);
    }
    return {
      ...part,
      id,
      name: trimOptional(part.name),
      quantity,
    };
  });
}

function getManagerMetadata(callerProfile, existingJob = {}) {
  const mid = normalizeId(callerProfile?.mid || existingJob?.mid);
  const mname = trimOptional(callerProfile?.name || callerProfile?.email || existingJob?.mname);
  return {
    mid: mid || null,
    mname: mname || null,
  };
}

async function resolveJobMutationPayload({
  input,
  existingJob = {},
  resolvedRole,
  callerProfile,
  jobType,
  isCreate,
  maxArrayLength,
  loadWorkerByWid,
  loadClientById,
  expectedFileJobId,
  expectedFileOwnerUid,
}) {
  const payload = pickMutableFields(input);
  validateArrayLengths(payload, maxArrayLength);
  validateInventoryPartList(payload, 'parts');
  validateInventoryPartList(payload, 'partsUsed');
  sanitizeJobFileFields(payload, {
    jobId: expectedFileJobId,
    ownerUid: expectedFileOwnerUid,
  });

  const cidProvided = hasOwn(input, 'cid');
  const cnameProvided = hasOwn(input, 'cname');
  const cphoneProvided = hasOwn(input, 'cphone');
  const widProvided = hasOwn(input, 'wid');

  if (resolvedRole === 'worker') {
    if (cidProvided || cnameProvided || cphoneProvided || widProvided || hasOwn(input, 'mid') || hasOwn(input, 'mname')) {
      throw new JobMutationError('permission-denied', 'Workers cannot change assignment or client identity fields');
    }
  }

  if (resolvedRole === 'manager' || resolvedRole === 'dev') {
    if (widProvided) {
      const wid = normalizeId(input.wid);
      if (wid) {
        const worker = await loadWorkerByWid(wid);
        if (!worker) {
          throw new JobMutationError('not-found', 'Assigned worker not found');
        }
        payload.wid = worker.wid;
        payload.wname = worker.name;
      } else {
        payload.wid = null;
        payload.wname = null;
      }
      Object.assign(payload, getManagerMetadata(callerProfile, existingJob));
    } else if (isCreate && jobType === 'pending') {
      payload.wid = null;
      payload.wname = null;
      Object.assign(payload, getManagerMetadata(callerProfile, existingJob));
    }
  } else {
    delete payload.mid;
    delete payload.mname;

    if (isCreate && resolvedRole === 'user') {
      const ownWid = normalizeId(callerProfile?.wid);
      const ownName = trimOptional(callerProfile?.name || callerProfile?.email);
      payload.wid = ownWid || null;
      payload.wname = ownName || ownWid || null;
    } else {
      delete payload.wid;
      delete payload.wname;
    }
  }

  if (cidProvided) {
    const cid = normalizeId(input.cid);
    if (cid) {
      const client = await loadClientById(cid);
      if (!client) {
        throw new JobMutationError('not-found', 'Client not found');
      }
      payload.cid = client.id;
      payload.cname = client.name;
      payload.cphone = client.phone;
    } else {
      payload.cid = null;
      payload.cname = trimOptional(input.cname) || null;
      payload.cphone = trimOptional(input.cphone) || null;
    }
  } else if (cnameProvided || cphoneProvided || isCreate) {
    const nextClientName = trimOptional(
      cnameProvided ? input.cname : (isCreate ? '' : existingJob?.cname),
    );
    const nextClientPhone = trimOptional(
      cphoneProvided ? input.cphone : (isCreate ? '' : existingJob?.cphone),
    );

    if (!nextClientName) {
      throw new JobMutationError('invalid-argument', 'Client name is required');
    }

    payload.cid = null;
    payload.cname = nextClientName;
    payload.cphone = nextClientPhone || null;
  }

  if (jobType !== 'finished') {
    delete payload.finishedAt;
  }

  return payload;
}

module.exports = {
  JobMutationError,
  extractStoragePathFromUrl,
  normalizeJobFileRef,
  resolveJobMutationPayload,
};
