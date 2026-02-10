import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/team/ManageJobs';
export default withGate(Screen, { module: 'team', roles: ['manager'] });