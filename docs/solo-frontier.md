# Solo Frontier design and audit notes

## Player loop

Solo Frontier is a persistent solo order: choose **Push**, **Farm**, or **Pause**; configure a fallback stage; select a weapon, stance, technique, defensive ability, and aura; then inspect the return debrief. Push attempts the next uncleared stage. A loss records the wall diagnosis and returns the order to a cleared farm stage. Farm produces use-based combat XP, Boss Keys, collection progress, and targeted equipment. The player compares, equips, favourites, filters, salvages, or reforges drops before pushing again.

Stages 10, 20, and 30 are the Initiate, Vanguard, and Apex gates. They unlock the matching Arena tier and award Combat Discipline points on first clear. Regular stages advertise two target slots; 60% of item-base selection is directed to those slots. Early regular stages use a higher onboarding drop rate, while later repeat farming uses the steady-state rate. Boss first clears guarantee at least Rare quality, repeat bosses retain a higher item chance, and Chase remains a 0.05-weight rarity rather than a pacing assumption.

## Combat skill meanings

- **Strength** scales melee damage; **Melee Accuracy** improves every melee weight's hit chance.
- **Light**, **Medium**, and **Heavy Melee Weapon Proficiency** scale only their matching melee style.
- **Marksmanship**, **Ranged**, and **Offensive Magic** scale firearm, bow/crossbow, and spell damage plus accuracy.
- **Support Magic** scales Battle Focus; **Healing** scales Mend; **Warding** scales Arcane Barrier and magical defence.
- **Reflexes** shortens attack intervals, capped at 35%; **Vitality** adds maximum health; **Evasion** reduces enemy hit chance.
- **Light**, **Medium**, and **Heavy Armour Proficiency** scale armour per equipped piece. Light gear owns the evasion/tempo niche, medium balances offence and mitigation, and heavy maximizes health and physical mitigation.

## Balance contract

The production runtime and `npm run balance:solo` share named constants from `SOLO_FRONTIER_BALANCE`, `SOLO_FRONTIER_LOOT_CHANCE`, item-level scaling, and encounter recovery. The deterministic audit covers starter, melee, firearm, ranged, magic, all three armour weights, sustain, milestone, and intentionally poor builds. It does not grant Chase items.

Recorded deterministic results are in [`artifacts/solo-frontier/balance-report.json`](../artifacts/solo-frontier/balance-report.json). The accepted run measured:

| Criterion | Measurement |
| --- | ---: |
| First loot comparison | 5.03 minute median |
| First wall | Stage 7 after 20.3 minutes |
| Initiate / stage 10 | 2.46 hours |
| Vanguard / stage 20 | 60.70 hours / 2.53 days |
| Apex / stage 30 | 276.48 hours / 11.52 days |
| Eight-hour stage-15 farm | 16 item rolls before filters |
| Equivalent item-level style medians | 1.66–2.00 seconds at stage 15; all within 15% of the four-style median |
| Apex checkpoint without Chase | 82.4% seeded win rate |
| Eight-hour catch-up | under 1 second in the automated audit, with repeated event-loop yields |

Armour checks use the same ranged weapon and item level: light clears fastest and avoids the opening hit, medium clears faster than heavy while mitigating more than light, and heavy retains the most health and mitigation. The sustain build takes less damage than the balanced medium build. The intentionally poor build fails stage 15.

## Saves and migration

The current Momentum and Solo Frontier save version is **v20**. `migrateMomentumSaveToV20` is the single entry point and applies the idempotent v17→v18 combat split, v18→v19 paper-doll/loot migration, and v19→v20 Solo Frontier conversion. Representative v1, v14, v17, v18, and v19 fixtures are covered. Legacy Combat is removed from the generic skill list, its component progression is retained, v14 loot/filter/favourite state is preserved, and old Arena clears seed contiguous Solo Frontier credit without paying first-clear rewards twice.

## Debug and verification commands

```bash
npm run balance:solo
npm test
npm run typecheck
npm run build
npm run backend:test
npm run backend:typecheck
npm run backend:build
```

Open `/?qa=1`, switch to Solo Frontier, and use **Seed Stage 02**, **Force defeat**, **Fill cache 35**, and **Clear cache**. The same controls are available from `window.MomentumSoloFrontierDebug`; deterministic time control is exposed through `window.MomentumSoloFrontierRuntime.advance(ms)` and `.catchUp(seconds)`.

Browser evidence is recorded under `artifacts/solo-frontier/`: desktop, mobile, mobile controls, and reduced-motion screenshots. The structured pass checks the canvas and DOM control layer independently, desktop and 390×844 layouts, no horizontal overflow, returning-player debrief actions, stage/order controls, loadout, stance/ability selectors, filters, and zero browser warnings or errors. Reduce Motion applies the `reduce-motion` body class and zero-second canvas animation and shell transition durations without changing simulation timing.

## Deferred work

Companions, backend character persistence, matchmaking, chat, monetization, desktop battle overlays, additional regions, and new progression currencies remain deferred. Persistent online multiplayer and broader cooperative content remain separate roadmap work. Solo Frontier keeps renderer-free simulation and local v20 character state until those projects receive their own scope.
