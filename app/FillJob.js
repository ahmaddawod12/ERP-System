import { withGate } from '../modules/shared/gating/withGate';
import Screen from '../modules/solojob/screens/FillJob';
export default withGate(Screen, { module: 'jobs', roles: ['user', 'manager'] });