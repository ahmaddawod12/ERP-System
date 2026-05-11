import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/jobs/screens/EditJob';
export default withGate(Screen, { module: 'solojob', roles: ['user', 'manager'] });