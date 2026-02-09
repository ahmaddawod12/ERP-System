import { withGate } from '../modules/shared/gating/withGate';
import Screen from '../modules/solojob/screens/Userjob';
export default withGate(Screen, { module: 'jobs', roles: ['user', 'manager'] });