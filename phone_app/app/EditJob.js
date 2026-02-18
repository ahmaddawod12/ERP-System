import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/shared/EditJob';
export default withGate(Screen, { module: 'solojob', roles: ['user', 'manager'] });