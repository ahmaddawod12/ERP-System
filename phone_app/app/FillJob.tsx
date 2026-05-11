import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/jobs/screens/FillJob';
export default withGate(Screen, { module: 'solojob', roles: ['user', 'manager', 'worker'], roleModules: { worker: ['team'] } });