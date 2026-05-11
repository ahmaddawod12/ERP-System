import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/jobs/screens/Userjob';
export default withGate(Screen, { module: 'solojob', roles: ['user', 'manager'] });