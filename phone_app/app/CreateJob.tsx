import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/team/CreateJob';
export default withGate(Screen, { module: 'team', roles: ['manager'] });