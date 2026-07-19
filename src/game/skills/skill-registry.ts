import type {
  ActiveSkillActivity,
  ResourceMap,
  SkillActionContext,
  SkillActionResult,
  SkillDefinition,
  SkillState
} from './skill-types';

function cloneMap(value: ResourceMap | undefined): ResourceMap {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, amount]) => [key, Number(amount) || 0]));
}

function missingInputs(resources: Readonly<ResourceMap>, inputs: ResourceMap): string[] {
  return Object.entries(inputs)
    .filter(([resource, amount]) => (resources[resource] ?? 0) < amount)
    .map(([resource, amount]) => `${amount} ${resource}`);
}

export function acceptedAction(
  definition: SkillDefinition,
  context: SkillActionContext,
  consumed: ResourceMap,
  produced: ResourceMap,
  events: string[] = []
): SkillActionResult {
  return {
    accepted: true,
    consumed: cloneMap(consumed),
    produced: cloneMap(produced),
    xp: definition.xpPerAction,
    activeMultiplier: Math.max(1, context.activeMultiplier),
    events: [...events]
  };
}

export function rejectedAction(reason: string, definition: SkillDefinition, context: SkillActionContext): SkillActionResult {
  return {
    accepted: false,
    reason,
    consumed: {},
    produced: {},
    xp: 0,
    activeMultiplier: Math.max(1, context.activeMultiplier),
    events: []
  };
}

export function resolveSkillAction(definition: SkillDefinition, context: SkillActionContext): SkillActionResult {
  if (definition.resolveAction) return definition.resolveAction(context);

  const inputs = cloneMap(definition.idleInputs);
  const outputs = cloneMap(definition.idleOutputs);
  const missing = missingInputs(context.resources, inputs);
  if (missing.length > 0) return rejectedAction(`Requires ${missing.join(' and ')}`, definition, context);

  return acceptedAction(definition, context, inputs, outputs);
}

export function applySkillActionResult(resources: ResourceMap, result: SkillActionResult): void {
  if (!result.accepted) return;
  Object.entries(result.consumed).forEach(([resource, amount]) => {
    resources[resource] = Math.max(0, (resources[resource] ?? 0) - amount);
  });
  Object.entries(result.produced).forEach(([resource, amount]) => {
    resources[resource] = (resources[resource] ?? 0) + amount;
  });
}

export function createSkillRegistry(definitions: readonly SkillDefinition[] = []) {
  const byId = new Map<string, SkillDefinition>();
  definitions.forEach(definition => {
    if (!definition.id || byId.has(definition.id)) throw new Error(`Duplicate skill definition: ${definition.id}`);
    if (definition.baseActionsPerSecond <= 0 || definition.xpPerAction <= 0) {
      throw new Error(`Skill ${definition.id} must have positive rate and XP values.`);
    }
    byId.set(definition.id, Object.freeze({ ...definition }));
  });

  return Object.freeze({
    get(id: string): SkillDefinition | undefined { return byId.get(id); },
    list(): SkillDefinition[] { return [...byId.values()]; },
    resolve(id: string, context: SkillActionContext): SkillActionResult {
      const definition = byId.get(id);
      if (!definition) throw new Error(`Unknown skill definition: ${id}`);
      return resolveSkillAction(definition, context);
    },
    validateState(state: SkillState): boolean {
      return Boolean(byId.has(state.id) && state.level >= 1 && state.xp >= 0 && state.nextXp > 0 && state.progress >= 0);
    }
  });
}

export function resolveActiveSkillBonus(activity: ActiveSkillActivity, score: number): number {
  return Math.max(1, Math.min(activity.maxBonusMultiplier, activity.scoreToMultiplier(score)));
}
