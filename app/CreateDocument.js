import { withGate } from '../modules/shared/gating/withGate';
import Screen from '../modules/documents/screens/CreateDocument';
export default withGate(Screen, { module: 'documents', roles: ['user', 'basic', 'manager'] });