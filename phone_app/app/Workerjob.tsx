import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/team/Workerjob';
export default withGate(Screen, { module: 'team', roles: ['worker'] });