import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { withGate } from '../modules/shared/gating/withGate';
import { useCache } from '../contexts/CacheContext';
import WorkerInventory from '../modules/inventory/teaminventory/screens/inventory';
import UserInventory from '../modules/inventory/personal/screens/UserInventory';

/**
 * Inventory route — renders the correct screen based on role:
 *  • worker / manager → WorkerInventory (company-linked parts)
 *  • user / basic     → UserInventory   (personal free-form parts)
 *  • If `workerId` param is passed (manager viewing worker), always team inventory
 */
function InventoryRouter() {
  const { workerId } = useLocalSearchParams();
  const { getUserRole } = useCache();
  const role = getUserRole();

  if (workerId || role === 'worker' || role === 'manager') {
    return <WorkerInventory />;
  }
  return <UserInventory />;
}

export default withGate(InventoryRouter, {
  module: 'inventory',
  roles: ['worker', 'manager', 'user', 'basic'],
});