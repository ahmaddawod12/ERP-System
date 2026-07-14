export function requireSqlCipherVersion(
  rows: readonly Record<string, unknown>[],
): string {
  const version = rows
    .flatMap((row) => Object.values(row))
    .find((value): value is string => (
      typeof value === 'string' && value.trim().length > 0
    ));

  if (!version) {
    throw new Error(
      'SQLCipher is required for the offline outbox, but this SQLite build does not expose it',
    );
  }

  return version.trim();
}
