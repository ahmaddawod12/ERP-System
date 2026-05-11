import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { withGate } from '../modules/shared/withGate';
import { useCache } from '../contexts/CacheContext';
import WorkerInventory from '../modules/inventory/screens/WorkerInventory';
import UserInventory from '../modules/inventory/screens/UserInventory';

/**
 * Inventory route — renders the correct screen based on role:
 *  • worker / manager → WorkerInventory (company-linked parts)
 *  • user / basic     → UserInventory   (personal free-form parts)
 *  • If `workerId` param is passed (manager viewing worker), always team inventory
 */
function InventoryRouter() {
  const { workerId } = useLocalSearchParams();
  const { profile } = useCache();
  const role = profile?.role;

  if (workerId || role === 'worker' || role === 'manager') {
    return <WorkerInventory />;
  }
  return <UserInventory />;
}

export default withGate(InventoryRouter, {
  module: 'teaminventory',
  roles: ['worker', 'manager', 'user', 'basic'],
  roleModules: { user: [], basic: [] },
});