import { useTenant } from '../contexts/TenantContext';
import { resolveInventoryReadScope } from '../modules/inventory/lib/inventory-list-model';
import Screen from '../modules/inventory/screens/CompanyInventory';
import NotAvailableScreen from '../modules/shared/NotAvailableScreen';

export default function CompanyInventoryRoute() {
  const { workspace } = useTenant();
  if (!workspace?.enabledModules.includes('inventory')) {
    return <NotAvailableScreen reason="module" />;
  }
  if (resolveInventoryReadScope(workspace) !== 'company') {
    return <NotAvailableScreen reason="role" />;
  }
  return <Screen />;
}
