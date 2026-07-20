import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const envPath = '.env.playtest';
let fileEnv = {};

try {
  fileEnv = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
} catch {
  console.error(`Missing ${envPath}. Create it with the playtest backend address.`);
  process.exit(1);
}

const required = ['VITE_MOMENTUM_PARTY_MODE', 'VITE_MOMENTUM_BACKEND_URL'];
const missing = required.filter(name => !fileEnv[name]);
if (missing.length > 0) {
  console.error(`${envPath} is missing: ${missing.join(', ')}`);
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'tauri:build'], {
  stdio: 'inherit',
  env: { ...process.env, ...fileEnv }
});

process.exit(result.status ?? 1);
