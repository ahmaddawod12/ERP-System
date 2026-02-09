/**
 * Team Inventory Module (per-worker inventory)
 * Roles: worker (own), manager (view/edit worker inventories)
 * Gate: enabledModules.teaminventory AND enabledModules.inventory
 */
export { default as TeamInventory } from './screens/inventory';
