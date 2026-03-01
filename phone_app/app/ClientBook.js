import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/clients/ClientBook';
export default withGate(Screen, { module: 'clients', roles: ['manager', 'basic'] });
