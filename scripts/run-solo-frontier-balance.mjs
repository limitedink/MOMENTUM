import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['node_modules/vite-node/vite-node.mjs', 'scripts/solo-frontier-balance.ts'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SOLO_FRONTIER_BALANCE_REPORT: '1',
      SOLO_FRONTIER_BALANCE_OUTPUT: 'artifacts/solo-frontier/balance-report.json'
    },
    stdio: 'inherit'
  }
);

process.exitCode = result.status ?? 1;
