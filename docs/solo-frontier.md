# Momentum v21.2 — Wayfinder Bulwark

## Player loop

Wayfinder Arsenal adds the decision layer between idle sessions:

**Combat → loot, Gold, and XP → inspect gear → allocate points → buy, respec, or contract → choose Push or Farm → idle again.**

Solo Frontier remains a persistent solo order. **Push** attempts the next uncleared stage, **Farm** repeats a cleared stage, and **Pause** stops encounters without stopping Production or the independent Combat Drill. A loss records the original wall diagnosis and changes the order to the configured cleared fallback. The v21.2 decision is defensive preparation: inspect the threat, choose armour weight and a defensive loadout, allocate the relevant tree, then decide whether to Push or Farm.

## Canonical equipment and Arsenal UI

`soloFrontier.lootCache` is the only combat-item authority. Its `items` array owns every generated instance and its `equipment` loadout owns the paper-doll positions and active weapon. Arena, Solo Frontier, crafting, expeditions, loadout projection, the inspector, and the Exchange all consume those same instances. Non-combat tools remain in the legacy tool slot; equipped food is the stack-backed `foodId` and consumes no cache position.

The cache capacity is exactly **35 unequipped items**. Equipped items do not consume a position. The Arsenal renders 35 visible cells as 7×5 on desktop and 5×7 at 390px; grandfathered overflow remains accessible on additional 35-cell pages but new full-cache drops still become Salvage. Selection is separate from explicit Equip, Favourite, Salvage, and Reforge actions. Arrow keys move focus through the current grid.

The Wayfinder paper doll groups four arsenal slots on the left, six armour slots in the centre, and amulet, belt, two rings, two trinkets, and food on the right. Mobile collapses these into compact slot groups. Every filled surface uses `ItemVisualDescriptor`: rarity owns the outer border and glow, while equipped, active, favourite, and new states use inner or corner overlays. The v21 pack contains 44 unique item icons, 17 combat-skill icons, and 17 empty-slot icons as transparent 128×128 WebP files.

## Combat Matrix and Drill

The Skill Matrix is split into Production and Combat. Combat presents all 17 typed skills in Offense, Sustain, and Defense groups. Combat cards show icon, level, current XP, recent XP, earned/spent points, Drill state, and the tree action; they never receive Production toggles or Honing.

One Combat Drill may run beside Production and combat. It awards exactly **0.1 XP/second**, retains fractional XP, uses the normal 8-hour offline cap or the existing 12-hour extended cap, and automatically stops at level 100. Drill time creates no loot, Gold, use events, or tree-trigger effects.

## Skill trees and combat modifiers

Arena's existing compatible tree is presented as **Arena Discipline**. Every one of the 17 combat skills has an independent persisted tree state and earns one point at levels 10, 20, …, 100, for ten points total. Existing high-level saves receive earned points without automatic allocation.

The eight Offense trees, four Sustain trees (**Support Magic, Reflexes, Healing, and Vitality**), and five Defense trees (**Light Armour Proficiency, Medium Armour Proficiency, Heavy Armour Proficiency, Evasion, and Warding**) are authored. All 17 trees have exactly 21 nodes: three seven-node branches, each formed by one root followed by two independent three-node paths. Every node costs one point. The six capstones share one exclusive group, so lower paths may be mixed but only one capstone may be owned in a skill tree. A full-tree respec costs:

`100 + 50 × allocated nodes` Gold

Arena Discipline uses the same price and is locked only during an active Arena run. Every change saves immediately and affects the next Solo encounter.

Offense effects resolve through the typed `CombatTreeEffectDefinition` registry and `CombatModifierSnapshot`. Same-kind percentages add. Tree attack-speed reduction caps at 30%, technique cooldown reduction at 40%, total critical chance at 60%, and normal armour or ward penetration at 60. Explicit ignore-mitigation capstones bypass that final cap. Repeats and damage-over-time cannot recurse, critically strike, or award extra XP. Hit streaks, marks, shred, burns, bleeds, retaliation charges, first-hit state, and other counters are encounter-local and deterministic across online/offline continuation.

The deterministic balance report includes legal ten-point builds for Strength, Melee Accuracy, all three melee proficiencies, Marksmanship, Ranged, and Offensive Magic. Every capstone variant is also a legal ten-point build. Sibling capstones are compared inside their branch across a deterministic encounter portfolio covering opening burst, a short skirmish, sustained damage, a fortified boss, incoming pressure, evasion, and counterplay; total encounter throughput includes the standard recovery interval. Each sibling pair must remain within 15%. The report retains the all-six spread as a diagnostic because Power, Momentum, Execution, and equivalent branches intentionally solve different fights.

## Sustain effect contract

Support Magic links Battle Focus, Mend, and weapon techniques. Reflexes supplies universal tempo, retaliation, enemy-miss responses, and low-health urgency. Healing controls direct Mend output, healing-over-time, trigger timing, Recovery Reserve, and overheal conversion. Vitality controls maximum HP, healing received, regeneration, damage recovery, emergency healing, a once-per-encounter fatal guard, and low-health damage reduction.

All four trees resolve through the shared typed modifier registry. Static and conditional modifiers use the same combat context as Offense, including the selected aura, defensive ability, and current player-health ratio. Encounter-local trigger state, recovery ticks, reserve, emergency uses, and cooldown changes reset between encounters. Tree-created recovery, repeats, and emergency Mends do not emit use events or award extra combat XP.

Sustain caps are:

- Maximum HP: **+40%**.
- Healing: **+75%**.
- Mend cooldown reduction: **40%**.
- Mend trigger threshold: **85% HP**.
- Additional Battle Focus damage: **+10 percentage points**.
- Damage-taken reduction: **15%**.
- Regeneration: **1% maximum HP per second**.
- Recovery Reserve: **20% maximum HP**.
- Damage recovery: **20% of damage taken**.
- Fatal-guard recovery: **15% maximum HP**.

Recovery events resolve before attacks at the same timestamp so online, offline, save/reload, and batched catch-up remain identical. The Survival Report records effective healing, overheal, recovery by source, Mend casts, reserve stored/released, damage recovery and prevention, cooldown removed, minimum health, time below half health, emergency triggers, and fatal guards.

The tree panel now treats node selection and point spending as separate actions. Selecting a node shows the current and projected live build profile; **Allocate 1 point** confirms the irreversible spend. The profile uses the current weapon, stance, aura, defensive ability, stage, and equipment. It warns when Support Magic or Healing effects are inactive under the current Battle Desk configuration.

Solo Frontier implements the complete deterministic Sustain and Defense contracts. Arena reuses only the representable Defense subset: matching armour, ward, physical/magical reduction, defensive cooldown, and Arcane Barrier strength/cooldown. Arena does not fake Solo attack-cycle conversions, adaptation, retaliation, or Defense-generated skill-use events. Arena Discipline remains separate and save-compatible.

## Frontier threats and Defense resolution

Every authored stage threat is deterministic and consumes exactly one existing enemy hit roll per scheduled attack. A custom/test enemy without threat metadata retains the legacy single physical attack.

| Profile | Cadence | Ordered attack cycle |
| --- | ---: | --- |
| Standard | ×1.00 | Physical ×1.00 |
| Skirmisher | ×0.72 | Physical ×0.70, +10 accuracy, Rapid |
| Breaker | ×1.35 | Physical ×1.40, −8 accuracy, 20% armour penetration, Heavy |
| Arcanist | ×1.00 | Magical ×1.00, +2 accuracy, 10% ward penetration, Arcane |
| Spellblade | ×0.92 | Physical ×0.90, then Magical ×0.90, both +2 accuracy |
| Initiate | ×1.00 | Physical ×0.80, Physical ×0.80, Heavy Physical ×1.40 with 10% penetration |
| Vanguard | ×0.95 | Physical ×0.85, Magical ×0.85, Heavy Physical ×1.15 with 15% penetration |
| Apex | ×0.95 | Physical ×0.80, Magical ×0.80, Heavy Physical ×1.10 with 20% penetration, Magical ×1.10 with 20% penetration |

Stages assign these profiles as follows: 1–3 Standard; 4 Skirmisher; 5 Breaker; 6 Standard; 7 Arcanist; 8 Spellblade; 9 Breaker; 10 Initiate; 11 Skirmisher; 12 Breaker; 13 Arcanist; 14 Spellblade; 15 Skirmisher; 16 Standard; 17 Arcanist; 18 Breaker; 19 Spellblade; 20 Vanguard; 21 Skirmisher; 22 Breaker; 23 Arcanist; 24 Spellblade; 25 Skirmisher; 26 Breaker; 27 Arcanist; 28 Spellblade; 29 Breaker; 30 Apex.

Incoming attacks resolve in this order: natural hit roll, tree hit conversion, glance/guard, penetration, armour or ward mitigation, Defense reduction, Sustain reduction, Arcane Barrier, then HP and counters. Converted misses do not grant Evasion XP; glances remain hits; retaliation cannot crit, recurse, trigger another effect, or award XP.

Defense caps are **+50% matching armour**, **+60% ward**, **+30 Evasion**, **10 percentage points enemy hit reduction**, **20% physical or magical reduction**, **50% glance/guard reduction**, **50% penetration resistance**, **+100% Barrier strength**, **40% Mend/Barrier cooldown reduction**, **30% triggered attack speed**, and **35% triggered attack damage**. Periodic hit conversion cannot be better than one in five would-be hits. Existing armour and magical mitigation caps remain 75% and 60%.

Only helm, chest, gloves, pants, boots, and cloak count toward armour commitment. Light, Medium, and Heavy tree effects are inactive until the matching set reaches **2 pieces** for roots/first-path nodes, **4 pieces** for second-path nodes, and **6 pieces** for capstones. Allocation is allowed before the gear is equipped. The paper doll shows the three counts and active breakpoints; requisitions, contracts, and inventory filters can target Light, Medium, or Heavy weight. Old contracts normalize to Any weight.

Threat Intel shows the selected stage’s profile, ordered cycle, cadence, damage types, penetration, current hit chance, and current physical/magical mitigation. The Survival Report records natural and converted misses, glances, armour/ward/Defense prevention, penetration resisted, Barrier absorption and breaks, retaliation, and Defense proc counts. Both surfaces consume simulation data rather than maintaining duplicate formulas.

## Gold and Frontier Exchange

Successful Solo encounter time awards Gold at:

`Gold/minute = 1 + 0.1 × stage`

Fractional Gold persists in runtime state. Defeats pay zero. First-clear boss rewards are **250 Gold at stage 10**, **750 at stage 20**, and **2,000 at stage 30**.

Permanent decisions are:

- **Tree respec:** `100 + 50 × allocated nodes` Gold.
- **Quartermaster Requisition:** choose one exact gear category and pay `150 + 20 × highest cleared stage`. It produces one same-level item with Common/Uncommon/Rare/Epic weights 50/35/12/3. Legendary and higher remain combat chase drops.
- **Target Contract:** choose one exact category and pay `200 + 20 × highest cleared stage`. One contract may exist at a time. Eight successful Solo hours route 70% of item-base rolls to that category, then create one held Rare+ item. Cancellation gives no refund; contracts never expire; a full cache keeps the reward pending rather than salvaging it.

Daily stock is deterministic from UTC day plus the Solo save seed and never moves its saved day backwards. Each offer may be purchased once:

- 50 Bars for 200 Gold.
- 10 Crafted Components for 250 Gold.
- 10 units of one deterministic food for 150 Gold.
- One deterministic Rare/Epic weapon.
- One deterministic Rare/Epic armour or accessory.
- One Rare Gem for 750 Gold.

Rare gear costs `400 + 30 × item level`; Epic gear costs `700 + 35 × item level`. Every transaction validates funds and destination capacity before changing wallet, cache, purchase state, or the earned/spent source ledger.

## Saves and migration

The Momentum and Solo Frontier save version remains **v21**. v21.2 adds no migration boundary: all 17 tree-state slots, Defense telemetry fields, and optional armour-weight contract fields normalize in place, while existing allocations and unspent points remain untouched. `migrateMomentumSaveToV21` remains the single idempotent entry point for v1–v21 and runs the prior combat split, paper-doll, loot, Solo, and Defense normalizers before canonicalization.

The v21 boundary preserves generated instance IDs, rarity, item level, affixes, favourites, equipped positions, active weapon, `foodId`, 35-slot grandfathered overflow, and legacy refinements. Pulse Sidearm, Iron Blade, Frontier Bow, Ember Focus, and Plated Vest map to canonical definitions. Each legacy refinement rank becomes `enhancementRank` and retains +2 damage per rank. Overlapping legacy projections deduplicate by instance ID and root-level combat loot projections are removed from the resulting save. Only the non-combat tool remains in the root `equipment` object.

Representative v1, v14, v17, v18, v19, and v20 fixtures migrate through v21 twice with byte-equivalent output.

## Deterministic verification

`npm run balance:solo` writes `artifacts/solo-frontier/balance-report.json`. The accepted route remains approximately **2.46 hours** to stage 10, **60.44 hours** to stage 20, and **275.43 hours** to stage 30, with a **5.03-minute** median first-loot comparison and **16** median item rolls during an eight-hour stage-15 farm. The current deterministic checkpoint win rates are **100% at stage 20** and **100% at stage 30**. The report records all 17 authored trees and 357 nodes, legal ten-point Defense builds, five threat-fit portfolios, raw survival telemetry, and modifier-cap observations. Focused Defense improvements are 8–28%, profile DPS ratios remain within 8% of Standard, sibling capstone spreads remain below 20% inside each branch portfolio, and counter-pressure raises throughput by at most **2.48%**. Raw HP/survival leaders remain visible as diagnostics; the release gate’s threat-fit score weights the prevention mechanic that each profile is intended to test.

Release checks are:

```bash
npm test
npm run typecheck
npm run build
npm run balance:solo
git diff --check
```

Automated contracts cover the 35-cell responsive grid, exact slot filtering, keyboard movement, shared rarity renderer, all 78 asset mappings, historical migration, online/offline replay, Drill caps, Gold and boss rewards, store rollback protection, atomic purchases, contract reward holding, tree topology, every Offense and Sustain root/capstone, save-stable Survival Report aggregation, Arena’s universal Sustain subset, and equipped Common-through-Chase rarity presentation.

## Release scope

v21.2 completes the 17-tree combat progression and adds deterministic threat preparation, armour breakpoints, weight targeting, Threat Intel, and the expanded Defense Report. No save-version bump is required.

Multiplayer/backend expansion, desktop battle overlays, companions, matchmaking, monetization, and additional regions remain outside Wayfinder Arsenal. No human playtest gate is part of this release workflow.
