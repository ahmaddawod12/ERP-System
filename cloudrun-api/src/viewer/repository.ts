import type { DatabaseQueryable } from "../database/runtime.js";
import { listWorkspaceSummaries } from "../workspaces/repository.js";

export interface ViewerDatabaseData {
  readonly displayName: string | null;
  readonly workspaces: Awaited<ReturnType<typeof listWorkspaceSummaries>>;
}

interface ViewerProfileRow {
  readonly display_name: string | null;
}

export async function readViewerDatabaseData(
  transaction: DatabaseQueryable,
  userId: string,
): Promise<ViewerDatabaseData> {
  const profile = await transaction.query<ViewerProfileRow>(
    `SELECT app_user.display_name
     FROM public.app_users app_user
     WHERE app_user.id = $1
     LIMIT 1`,
    [userId],
  );
  const workspaces = await listWorkspaceSummaries(transaction, userId);
  return {
    displayName: profile.rows[0]?.display_name ?? null,
    workspaces,
  };
}
