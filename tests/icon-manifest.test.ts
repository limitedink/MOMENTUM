import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMBAT_SKILL_IDS } from '../src/game/combat-progression';
import {
  COMBAT_SKILL_ICON_MANIFEST,
  ITEM_ICON_MANIFEST,
  PAPER_DOLL_SLOT_ICON_MANIFEST,
  WAYFINDER_ICON_MANIFEST
} from '../src/game/icons';
import { COMBAT_LOOT_DEFINITIONS, PAPER_DOLL_SLOT_IDS, type IconRef } from '../src/game/loot';

function assetPath(icon: IconRef): string {
  if (icon.kind !== 'asset') throw new Error(`${icon.id} is not an asset-backed v21 icon.`);
  return resolve(process.cwd(), 'public', icon.src.replace(/^\.\//, ''));
}

function losslessWebpHeader(buffer: Buffer) {
  expect(buffer.subarray(0, 4).toString()).toBe('RIFF');
  expect(buffer.subarray(8, 12).toString()).toBe('WEBP');
  expect(buffer.subarray(12, 16).toString()).toBe('VP8L');
  expect(buffer[20]).toBe(0x2f);
  const packed = buffer.readUInt32LE(21);
  return {
    width: (packed & 0x3fff) + 1,
    height: ((packed >>> 14) & 0x3fff) + 1,
    alphaUsed: Boolean((packed >>> 28) & 1)
  };
}

describe('v21 Wayfinder icon manifest', () => {
  it('maps every canonical item, combat skill and paper-doll slot exactly once', () => {
    expect(Object.keys(ITEM_ICON_MANIFEST)).toHaveLength(44);
    expect(new Set(COMBAT_LOOT_DEFINITIONS.map(definition => definition.iconId))).toEqual(new Set(Object.keys(ITEM_ICON_MANIFEST)));
    expect(Object.keys(COMBAT_SKILL_ICON_MANIFEST)).toEqual([...COMBAT_SKILL_IDS]);
    expect(Object.keys(PAPER_DOLL_SLOT_ICON_MANIFEST)).toEqual([...PAPER_DOLL_SLOT_IDS]);
    expect(Object.keys(WAYFINDER_ICON_MANIFEST)).toHaveLength(78);
  });

  it('ships 78 unique, readable, transparent 128x128 WebP files with no unmapped extras', () => {
    const icons = Object.values(WAYFINDER_ICON_MANIFEST);
    const mappedPaths = icons.map(assetPath);
    const onDisk = ['items', 'combat-skills', 'equipment-slots']
      .flatMap(folder => readdirSync(resolve(process.cwd(), 'public/assets/icons', folder)).map(file => resolve(process.cwd(), 'public/assets/icons', folder, file)))
      .sort();
    expect(onDisk).toEqual([...mappedPaths].sort());

    const hashes = new Set<string>();
    for (const path of mappedPaths) {
      const bytes = readFileSync(path);
      expect(bytes.byteLength, `${path} is too small to be a readable painted icon`).toBeGreaterThan(500);
      expect(losslessWebpHeader(bytes)).toEqual({ width: 128, height: 128, alphaUsed: true });
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(hashes.size).toBe(mappedPaths.length);
  });
});
