import { compatibleTechniqueForWeaponStyle } from './solo-combat-engine';
import {
  SOLO_COMBAT_STANCES,
  TECHNIQUE_IDS,
  type AuraId,
  type DefensiveAbilityId,
  type SoloCombatStance,
  type TechniqueId,
  type WeaponStyle
} from './solo-frontier-types';

export interface SoloDeskCombatControls {
  stance: SoloCombatStance;
  technique: TechniqueId;
  defensive: DefensiveAbilityId | 'none';
  aura: AuraId | 'none';
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function normalizeSoloCombatControls(value: unknown, weaponStyle: WeaponStyle): SoloDeskCombatControls {
  const source = isRecord(value) ? value : {};
  const stance = SOLO_COMBAT_STANCES.find(candidate => candidate === source.stance) || 'Balanced';
  const defensive: DefensiveAbilityId | 'none' = source.defensive === 'Mend' || source.defensive === 'Arcane Barrier' || source.defensive === 'none'
    ? source.defensive
    : 'none';
  const aura: AuraId | 'none' = source.aura === 'Battle Focus' || source.aura === 'none'
    ? source.aura
    : 'none';
  const compatibleTechnique = compatibleTechniqueForWeaponStyle(weaponStyle);
  const technique = TECHNIQUE_IDS.includes(source.technique as TechniqueId) && source.technique === compatibleTechnique
    ? source.technique as TechniqueId
    : compatibleTechnique;
  return { stance, technique, defensive, aura };
}
