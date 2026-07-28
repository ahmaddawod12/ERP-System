import type {
  BootstrapCounts,
  WorkspaceSummary,
} from '@smart-job/api-contracts';

const CORE_DASHBOARD_MODULES = new Set([
  'solojob',
  'clients',
  'inventory',
  'documents',
]);

const WORKER_DASHBOARD_MODULES = new Set([
  'solojob',
  'inventory',
]);

const MANAGER_ROLES = new Set<WorkspaceSummary['role']>(['manager', 'dev']);
const USER_ROLES = new Set<WorkspaceSummary['role']>(['user']);
const WORKER_ROLES = new Set<WorkspaceSummary['role']>(['worker']);
const BASIC_ROLES = new Set<WorkspaceSummary['role']>(['basic']);

function canLoadRoleBootstrap(
  workspace: Pick<WorkspaceSummary, 'role' | 'enabledModules'> | null | undefined,
  roles: ReadonlySet<WorkspaceSummary['role']>,
  modules: ReadonlySet<string>,
): boolean {
  return Boolean(
    workspace
    && roles.has(workspace.role)
    && workspace.enabledModules.some((moduleName) => modules.has(moduleName)),
  );
}

export function canLoadManagerBootstrap(
  workspace: Pick<WorkspaceSummary, 'role' | 'enabledModules'> | null | undefined,
): boolean {
  return canLoadRoleBootstrap(
    workspace,
    MANAGER_ROLES,
    CORE_DASHBOARD_MODULES,
  );
}

export function canLoadUserBootstrap(
  workspace: Pick<WorkspaceSummary, 'role' | 'enabledModules'> | null | undefined,
): boolean {
  return canLoadRoleBootstrap(workspace, USER_ROLES, CORE_DASHBOARD_MODULES);
}

export function canLoadWorkerBootstrap(
  workspace: Pick<WorkspaceSummary, 'role' | 'enabledModules'> | null | undefined,
): boolean {
  return canLoadRoleBootstrap(workspace, WORKER_ROLES, WORKER_DASHBOARD_MODULES);
}

export function canLoadBasicProfile(
  workspace: Pick<WorkspaceSummary, 'role' | 'enabledModules'> | null | undefined,
): boolean {
  return canLoadRoleBootstrap(workspace, BASIC_ROLES, CORE_DASHBOARD_MODULES);
}

export interface BootstrapCountValues {
  readonly jobs: string;
  readonly clients: string;
  readonly inventoryParts: string;
  readonly documents: string;
  readonly pendingDocumentTasks: string;
}

export function bootstrapCountValues(
  counts: BootstrapCounts | null | undefined,
): BootstrapCountValues {
  return {
    jobs: counts ? String(counts.jobs) : '—',
    clients: counts ? String(counts.clients) : '—',
    inventoryParts: counts ? String(counts.inventoryParts) : '—',
    documents: counts ? String(counts.documents) : '—',
    pendingDocumentTasks: counts ? String(counts.pendingDocumentTasks) : '—',
  };
}
