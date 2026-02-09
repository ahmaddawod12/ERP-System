import { withGate } from '../modules/shared/gating/withGate';
import Screen from '../modules/inventory/company/screens/CompanyInventory';
export default withGate(Screen, { module: 'inventory', roles: ['manager', 'user'] });