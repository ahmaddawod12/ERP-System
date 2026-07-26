export const REQUIRED_NODE_MAJOR = 22;

export function assertSupportedNodeVersion(
  version = process.versions.node,
  requiredMajor = REQUIRED_NODE_MAJOR,
) {
  const major = Number.parseInt(String(version).replace(/^v/, "").split(".", 1)[0] ?? "", 10);
  if (!Number.isInteger(major) || major !== requiredMajor) {
    throw new Error(
      `Node ${requiredMajor}.x is required; found ${String(version || "unknown")}`,
    );
  }
}
