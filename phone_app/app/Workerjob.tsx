import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/workers/screens/Workerjob';
export default withGate(Screen, { module: 'team', roles: ['worker'] });