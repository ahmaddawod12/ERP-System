import { useLocalSearchParams } from 'expo-router';

import { useTenant } from '../contexts/TenantContext';
import { resolveInventoryReadScope } from '../modules/inventory/lib/inventory-list-model';
import CompanyInventory from '../modules/inventory/screens/CompanyInventory';
import WorkerInventory from '../modules/inventory/screens/WorkerInventory';
import NotAvailableScreen from '../modules/shared/NotAvailableScreen';

/**
 * Inventory route backed by the authorization rules of the domain API:
 * - workers read their own member inventory;
 * - managers, users, and developers read company inventory;
 * - basic, module-disabled, and cross-member views issue no inventory request.
 */
export default function InventoryRouter() {
  const { wid } = useLocalSearchParams();
  const { workspace } = useTenant();
  const scope = resolveInventoryReadScope(workspace);

  if (wid) {
    return <NotAvailableScreen reason="role" />;
  }
  if (!workspace?.enabledModules.includes('inventory')) {
    return <NotAvailableScreen reason="module" />;
  }
  if (scope === 'member') {
    return <WorkerInventory />;
  }
  if (scope === 'company') {
    return <CompanyInventory />;
  }
  return <NotAvailableScreen reason="role" />;
}
