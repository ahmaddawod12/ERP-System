import { AppError } from "../http/errors.js";

const VERSION_PREFIX = "ev1.";
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

function invalidEntityVersion(): AppError {
  return new AppError({
    statusCode: 400,
    code: "INVALID_ENTITY_VERSION",
    message: "The entity version is invalid.",
    fieldErrors: { entityVersion: ["Reload the entity and try again."] },
  });
}

export function encodeEntityVersion(value: bigint | number | string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw invalidEntityVersion();
  }
  if (parsed < 1n || parsed > MAX_SIGNED_BIGINT) {
    throw invalidEntityVersion();
  }
  return `${VERSION_PREFIX}${Buffer.from(parsed.toString(), "utf8").toString("base64url")}`;
}

export function decodeEntityVersion(value: string): bigint {
  if (!value.startsWith(VERSION_PREFIX)) {
    throw invalidEntityVersion();
  }

  let decoded: string;
  try {
    decoded = Buffer.from(value.slice(VERSION_PREFIX.length), "base64url").toString("utf8");
  } catch {
    throw invalidEntityVersion();
  }
  if (!/^[1-9][0-9]{0,18}$/.test(decoded)) {
    throw invalidEntityVersion();
  }

  const parsed = BigInt(decoded);
  if (encodeEntityVersion(parsed) !== value) {
    throw invalidEntityVersion();
  }
  return parsed;
}
