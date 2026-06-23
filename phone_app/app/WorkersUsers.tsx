import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/workers/screens/WorkersUsers';
export default withGate(Screen, { module: 'team', roles: ['manager'] });