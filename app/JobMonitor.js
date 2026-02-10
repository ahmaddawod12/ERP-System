import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/team/JobMonitor';
export default withGate(Screen, { module: 'team', roles: ['manager'] });