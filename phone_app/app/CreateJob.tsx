import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/jobs/screens/CreateJob';
export default withGate(Screen, { module: 'team', roles: ['manager'] });