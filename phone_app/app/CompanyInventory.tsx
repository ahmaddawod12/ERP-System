import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/inventory/CompanyInventory';
export default withGate(Screen, { module: 'companyinventory', roles: ['manager', 'user'] });