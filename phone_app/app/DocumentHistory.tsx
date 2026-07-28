import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/documents/screens/DocumentHistory';
export default withGate(Screen, { module: 'documents', roles: ['user', 'basic', 'manager'] });