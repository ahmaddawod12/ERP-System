import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/clients/screens/ClientBook';
export default withGate(Screen, { roles: ['manager', 'basic'] });
