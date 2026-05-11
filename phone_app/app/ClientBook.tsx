import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/clients/ClientBook';
export default withGate(Screen, { roles: ['manager', 'basic'] });
