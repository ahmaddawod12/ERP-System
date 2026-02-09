import { withGate } from '../modules/shared/gating/withGate';
import Screen from '../modules/team/screens/WorkersMonitor';
export default withGate(Screen, { module: 'team', roles: ['manager'] });