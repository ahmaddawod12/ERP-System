import { withGate } from '../modules/shared/withGate';
import Screen from '../modules/documents/DocumentHistory';
export default withGate(Screen, { module: 'documents', roles: ['user', 'basic', 'manager'] });