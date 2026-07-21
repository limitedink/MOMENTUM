import type { RegionDefinition } from './world-types';

export const FRONTIER_REGION: RegionDefinition = {
  id: 'frontier-outpost',
  name: 'The Frontier Line',
  summary: 'A small advance beyond the outpost. Choose the route that matches your preparation, then break the Vanguard gate.',
  outpostNodeId: 'frontier-outpost',
  routes: [
    {
      id: 'timberline',
      name: 'Timberline Trail',
      summary: 'Gather provisions and let Woodcutting carry the route.',
      accent: '#62e6a7',
      encounterId: 'timberline-supply'
    },
    {
      id: 'ironworks',
      name: 'Ironworks Ruins',
      summary: 'Turn Bars and Components into a field-ready repair kit.',
      accent: '#ffcf5c',
      encounterId: 'ironworks-repair'
    },
    {
      id: 'broken-watch',
      name: 'Broken Watch',
      summary: 'Scout a combat route and rely on your build to keep the line open.',
      accent: '#ff637d',
      encounterId: 'broken-watch-scout'
    }
  ],
  nodes: [
    {
      id: 'frontier-outpost',
      name: 'Frontier Outpost',
      description: 'A safe staging point for the next push.',
      routeId: null,
      encounterId: null,
      safe: true
    },
    {
      id: 'timberline',
      name: 'Timberline Trail',
      description: 'A steep green route with enough timber to keep the expedition moving.',
      routeId: 'timberline',
      encounterId: 'timberline-supply',
      safe: false
    },
    {
      id: 'ironworks',
      name: 'Ironworks Ruins',
      description: 'Old machinery, usable Bars, and a workshop challenge under pressure.',
      routeId: 'ironworks',
      encounterId: 'ironworks-repair',
      safe: false
    },
    {
      id: 'broken-watch',
      name: 'Broken Watch',
      description: 'A hostile overlook where a prepared loadout matters more than raw stockpiles.',
      routeId: 'broken-watch',
      encounterId: 'broken-watch-scout',
      safe: false
    },
    {
      id: 'vanguard-gate',
      name: 'Vanguard Gate',
      description: 'The first true frontier gate. Beat Vanguard to secure the region.',
      routeId: null,
      encounterId: 'vanguard-gate',
      safe: true
    }
  ],
  encounters: [
    {
      id: 'timberline-supply',
      name: 'Secure the Timberline',
      kind: 'gathering',
      routeId: 'timberline',
      summary: 'Use Woodcutting and a small Pine stockpile to secure the route.',
      requirements: [
        { type: 'skillLevel', skillId: 'Woodcutting', level: 2 },
        { type: 'resource', resourceId: 'Pine Logs', amount: 5 }
      ],
      nextNodeId: 'vanguard-gate',
      reward: { resources: { 'Pine Logs': 18 }, skillXp: { Woodcutting: 100 } },
      activeActivity: 'fishing'
    },
    {
      id: 'ironworks-repair',
      name: 'Repair the Old Works',
      kind: 'preparation',
      routeId: 'ironworks',
      summary: 'Spend Bars and Components to restore a route-side forge.',
      requirements: [
        { type: 'skillLevel', skillId: 'Smithing', level: 3 },
        { type: 'resource', resourceId: 'Bars', amount: 5 },
        { type: 'resource', resourceId: 'Crafted Components', amount: 1 }
      ],
      nextNodeId: 'vanguard-gate',
      reward: { resources: { Ore: 90, Bars: 4 }, skillXp: { Smithing: 100, Crafting: 80 } },
      activeActivity: 'crafting'
    },
    {
      id: 'broken-watch-scout',
      name: 'Scout the Broken Watch',
      kind: 'choice',
      routeId: 'broken-watch',
      summary: 'Take the exposed route. Your build and food determine how safely you reach the gate.',
      requirements: [
        { type: 'soloStage', stage: 5 },
        { type: 'equipment', slot: 'combat' }
      ],
      nextNodeId: 'vanguard-gate',
      reward: { resources: { 'Boss Keys': 2 }, skillXp: { Ranged: 60, Reflexes: 40 } }
    },
    {
      id: 'vanguard-gate',
      name: 'Break the Vanguard Gate',
      kind: 'boss',
      routeId: 'finale',
      summary: 'Spend the keys and reuse the Arena to defeat Vanguard.',
      requirements: [
        { type: 'soloStage', stage: 20 },
        { type: 'resource', resourceId: 'Boss Keys', amount: 5 },
        { type: 'completedNode', nodeId: 'frontier-outpost' }
      ],
      nextNodeId: 'frontier-outpost',
      reward: {
        skillXp: { 'Offensive Magic': 100, Vitality: 100 },
        mastery: 1
      },
      arenaTierId: 2,
      safeNode: true
    }
  ],
  mastery: [
    { id: 'route-timberline', name: 'Timberline Route', description: 'Complete the Timberline Trail.', target: 1 },
    { id: 'route-ironworks', name: 'Ironworks Route', description: 'Complete the Ironworks Ruins.', target: 1 },
    { id: 'route-watch', name: 'Watch Route', description: 'Complete the Broken Watch.', target: 1 },
    { id: 'vanguard-clear', name: 'Vanguard Gate', description: 'Defeat Vanguard through the adventure route.', target: 1 }
  ]
};

export const WORLD_REGIONS: readonly RegionDefinition[] = [FRONTIER_REGION];
