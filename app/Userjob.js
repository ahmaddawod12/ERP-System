import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/solojob/Userjob';
export default withGate(Screen, { module: 'solojob', roles: ['user', 'manager'] });