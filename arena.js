(() => {
  'use strict';

  const DASH_DURATION = 0.18;
  const DASH_COOLDOWN = 1;
  const PLAYER_SPEED = 150;
  const DASH_SPEED = 520;
  const PRESSURE_MAX = 5;
  const PRESSURE_PER_STACK = 0.1;

  let run = null;
  let rafId = null;
  const keysDown = Object.create(null);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function circleHit(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
  }

  function drawCircle(ctx, x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function hasTalent(id) {
    return run.talents.has(id);
  }

  function emit(type, payload = {}) {
    if (run?.onEvent) run.onEvent(type, payload);
  }

  function hasDirective(id) {
    return run?.directiveId === id;
  }

  function spawnImpact(x, y, color, count = 7) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 100;
      run.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.25 + Math.random() * 0.2,
        color
      });
    }
  }

  function resetPressure() {
    if (run.pressure > 0) run.pressure = 0;
    if (run && hasTalent('cadence')) run.cadenceHits = 0;
  }

  function consumeFood(automatic) {
    if (!run.food || run.foodUsed || run.you.hp >= run.you.maxHp) return false;
    if (!run.consumeFood(run.food.id)) return false;
    run.foodUsed = true;
    run.stats.foodConsumed += 1;
    if (hasTalent('combatNutrition')) run.foodShieldCharges = hasTalent('lastSupper') ? 2 : 1;
    run.you.hp = Math.min(run.you.maxHp, run.you.hp + run.food.instantHeal);
    if (run.food.regenHeal > 0) run.foodRegen = { remaining:run.food.regenHeal, duration:run.food.regenDuration };
    if (run.food.resetDash) run.you.dashCooldown = 0;
    run.elements.foodStatus.textContent = `${automatic ? 'Field Ration' : run.food.name} used: +${run.food.instantHeal} HP${run.food.resetDash ? ' · Dash ready' : ''}`;
    spawnImpact(run.you.x, run.you.y, '#62e6a7', 12);
    emit('food', { foodId:run.food.id, automatic });
    return true;
  }

  function damagePlayer(amount, x, y) {
    if (!run || run.you.dash > 0 || run.you.ghostTimer > 0) return false;
    if (run.foodShieldCharges > 0) {
      run.foodShieldCharges -= 1;
      spawnImpact(run.you.x, run.you.y, '#62e6a7', 14);
      emit('talent', { talentId:'combatNutrition' });
      return false;
    }
    if (run.aegisArmed) {
      run.aegisArmed = false;
      spawnImpact(run.you.x, run.you.y, '#7ee7ff', 14);
      emit('talent', { talentId:'aegis' });
      return false;
    }
    run.you.hp -= amount;
    run.stats.damageTaken += amount;
    emit('playerHit', { amount });
    run.you.hitFlash = 0.12;
    run.you.recoveryTimer = hasTalent('fortifiedRecovery') ? 6 : 0;
    if (hasTalent('counterforce')) run.counterforceArmed = true;
    resetPressure();
    run.shake = Math.max(run.shake, Math.min(8, 2 + amount * 0.08));

    if (run.you.hurtFxCooldown <= 0) {
      spawnImpact(x, y, '#ff637d', 8);
      run.you.hurtFxCooldown = 0.12;
    }

    if (run.you.hp <= 0 && hasTalent('secondWind') && !run.secondWindUsed) {
      run.secondWindUsed = true;
      run.stats.secondWindTriggered = true;
      emit('talent', { talentId:'secondWind' });
      run.you.hp = 1;
      run.shake = 8;
      spawnImpact(run.you.x, run.you.y, '#ffffff', 20);
    }

    if (run.you.hp > 0 && hasTalent('fieldRation') && run.you.hp / run.you.maxHp < 0.35) {
      consumeFood(true);
    }
    return true;
  }

  function damageBoss(baseDamage, source) {
    const bossHpBefore = run.boss.hp;
    let multiplier = 1;

    if (source.dashStrike) {
      multiplier *= 1.5;
      run.stats.dashStrikeHits += 1;
      emit('talent', { talentId:'dashStrike' });
    }
    if (hasTalent('openingAttack') && !run.openingAttackUsed) {
      multiplier *= 2;
      run.openingAttackUsed = true;
      run.stats.openingAttackTriggered = true;
      emit('talent', { talentId:'openingAttack' });
    }
    if (hasTalent('pressure')) multiplier *= 1 + run.pressure * PRESSURE_PER_STACK;
    let cadenceHit = false;
    if (hasTalent('cadence')) {
      run.cadenceHits += 1;
      cadenceHit = run.cadenceHits >= 3;
      if (cadenceHit) { run.cadenceHits = 0; multiplier *= 1.4; emit('talent', { talentId:'cadence' }); }
    }
    const counterforce = hasTalent('counterforce') && run.counterforceArmed;
    if (counterforce) {
      multiplier *= 1.5;
      run.counterforceArmed = false;
      emit('talent', { talentId:'counterforce' });
      if (hasTalent('reprisal')) {
        run.you.hp = Math.min(run.you.maxHp, run.you.hp + 12);
        emit('talent', { talentId:'reprisal' });
      }
    }

    let damage = baseDamage * multiplier;
    if (hasTalent('executioner') && !run.executionerUsed && bossHpBefore / run.boss.maxHp < 0.25) {
      damage += run.boss.maxHp * 0.15;
      run.executionerUsed = true;
      run.stats.executionerTriggered = true;
      emit('talent', { talentId:'executioner' });
      spawnImpact(run.boss.x, run.boss.y, '#ff637d', 18);
    }

    run.boss.hp -= damage;
    if (cadenceHit && hasTalent('overdrive')) {
      run.boss.stagger = Math.max(run.boss.stagger, 0.35);
      run.you.attackCooldown = 0;
      emit('talent', { talentId:'overdrive' });
    }
    run.stats.damageDealt += damage;
    run.boss.hitFlash = 0.1;
    run.shake = Math.max(run.shake, source.styleId === 'melee' ? 2.5 : 1.5);
    spawnImpact(source.x, source.y, source.styleId === 'melee' ? '#ffc857' : '#c7d2ff', source.styleId === 'melee' ? 8 : 5);
    emit('bossHit', { amount:damage, heavy:source.styleId === 'melee' || source.dashStrike });

    if (hasTalent('pressure')) {
      run.pressure = Math.min(PRESSURE_MAX, run.pressure + 1);
      run.stats.highestPressure = Math.max(run.stats.highestPressure, run.pressure);
    }
  }

  function attackModifier() {
    const active = hasTalent('dashStrike') && run.dashStrikeArmed && performance.now() <= run.dashStrikeUntil;
    run.dashStrikeArmed = false;
    return active;
  }

  function pointInSwing(point, aimAngle, range, arc) {
    const distance = Math.hypot(point.x - run.you.x, point.y - run.you.y);
    if (distance > range + point.r) return false;
    const pointAngle = Math.atan2(point.y - run.you.y, point.x - run.you.x);
    const delta = Math.atan2(Math.sin(pointAngle - aimAngle), Math.cos(pointAngle - aimAngle));
    return Math.abs(delta) <= arc / 2;
  }

  function meleeAttack(aimAngle) {
    const { you, boss, weapon } = run;
    if (you.attackCooldown > 0) return;
    you.attackCooldown = weapon.attackInterval;
    emit('attack', { styleId:'melee' });

    const arc = weapon.swingArcDeg * Math.PI / 180;
    const hit = pointInSwing(boss, aimAngle, weapon.range, arc);
    const dashStrike = attackModifier();
    run.meleeSwing = { angle: aimAngle, timeLeft: 0.12, hit };

    const before = run.enemyShots.length;
    run.enemyShots = run.enemyShots.filter(shot => !pointInSwing(shot, aimAngle, weapon.range + 12, arc));
    const deflected = before - run.enemyShots.length;
    if (deflected > 0) {
      run.stats.projectilesDeflected += deflected;
      spawnImpact(you.x + Math.cos(aimAngle) * weapon.range, you.y + Math.sin(aimAngle) * weapon.range, '#50d9ff', 5 + deflected * 2);
    }

    if (hit) damageBoss(weapon.damage, { styleId: 'melee', x: boss.x, y: boss.y, dashStrike });
    else resetPressure();
  }

  function gunAttack(dx, dy) {
    const { you, weapon } = run;
    if (you.attackCooldown > 0) return;
    you.attackCooldown = weapon.attackInterval;
    emit('attack', { styleId:'gun' });
    const length = Math.hypot(dx, dy) || 1;
    const speed = weapon.projectileSpeed || 400;
    run.gunSequence += 1;
    const pulse = run.gunSequence % 5 === 0;
    run.shots.push({
      x: you.x,
      y: you.y,
      r: pulse ? 5 : 2,
      vx: dx / length * speed,
      vy: dy / length * speed,
      damage: weapon.damage,
      lifetime: weapon.lifetime || 3,
      t: 0,
      hit: false,
      pulse,
      dashStrike: attackModifier()
    });
  }

  function useDash() {
    const { you } = run;
    if (you.dashCooldown > 0) return;
    you.dash = DASH_DURATION * (hasTalent('longstride') ? 1.4 : 1);
    if (hasTalent('ghostStep')) you.ghostTimer = you.dash + 0.35;
    you.dashCooldown = DASH_COOLDOWN;
    run.stats.dashesUsed += 1;
    run.phaseRushTriggered = false;
    if (hasTalent('slipstream')) run.you.slipstream = 1;
    emit('dash');
    if (hasTalent('dashStrike')) {
      run.dashStrikeArmed = true;
      run.dashStrikeUntil = performance.now() + 750;
    }
    if (hasTalent('afterimage')) {
      run.afterimage = { x: you.x, y: you.y, r: you.r, life: 1.5 };
    }
  }

  function fireVolley(count, spread, aimedAt, dropHazards = false, origin = null, ricochet = false) {
    const target = aimedAt || run.afterimage || run.you;
    const source = origin || run.boss;
    const aim = Math.atan2(target.y - source.y, target.x - source.x);
    const middle = (count - 1) / 2;
    for (let i = 0; i < count; i += 1) {
      const angle = aim + (i - middle) * spread;
      run.enemyShots.push({
        x: source.x,
        y: source.y,
        r: 6,
        vx: Math.cos(angle) * run.tier.projectileSpeed,
        vy: Math.sin(angle) * run.tier.projectileSpeed,
        damage: run.tier.projectileDamage,
        t: 0,
        distance: 0,
        dropHazard: dropHazards,
        maxTravel: dropHazards ? 220 : Infinity,
        bounces: ricochet ? 1 : 0,
        color: run.tier.id === 2 ? '#ffad42' : '#ff5b3d'
      });
    }
  }

  function beginBossAbility() {
    const { boss, tier } = run;
    let type = 'wave';
    if (tier.id === 2) type = boss.patternIndex % 2 === 0 ? 'aimed' : 'wave';
    if (tier.id === 3) type = boss.patternIndex % 2 === 0 ? 'spread' : 'wave';
    boss.patternIndex += 1;
    const target = run.afterimage || run.you;
    boss.telegraph = {
      type,
      time: type === 'aimed' ? 0.85 : type === 'spread' ? 0.95 : 1.2,
      duration: type === 'aimed' ? 0.85 : type === 'spread' ? 0.95 : 1.2,
      targetX: target.x,
      targetY: target.y
    };
    emit('telegraph', { kind:type, directiveId:run.directiveId });
  }

  function resolveBossAbility() {
    const telegraph = run.boss.telegraph;
    if (!telegraph) return;
    if (telegraph.type === 'wave') {
      run.wave = { r: 28, speed: 140, max: 280, interacted: false, echo:false };
      emit('wave');
      if (hasDirective('echoProtocol')) run.delayedEffects.push({ type:'echoWave', time:2.55 });
      if (hasDirective('seismicPursuit')) run.delayedEffects.push({ type:'chargeTelegraph', time:2.45 });
    } else if (telegraph.type === 'aimed') {
      const ricochet = hasDirective('ricochetProtocol');
      fireVolley(1, 0, { x: telegraph.targetX, y: telegraph.targetY }, false, null, ricochet);
      if (hasDirective('crossfire')) run.delayedEffects.push({ type:'crossfire', time:0.75, targetX:telegraph.targetX, targetY:telegraph.targetY });
    } else if (telegraph.type === 'charge') {
      const angle = Math.atan2(telegraph.targetY - run.boss.y, telegraph.targetX - run.boss.x);
      run.boss.charge = { vx:Math.cos(angle) * 520, vy:Math.sin(angle) * 520, time:0.65, hit:false };
    } else {
      fireVolley(3, run.tier.projectileSpread, { x: telegraph.targetX, y: telegraph.targetY }, true);
    }
    run.boss.telegraph = null;
    run.boss.abilityCooldown = run.tier.id === 1 ? run.tier.waveCooldown : run.tier.id === 2 ? 2.8 : 2.35;
  }

  function updateBoss(dt) {
    const { boss, you, tier } = run;
    if (boss.stagger > 0) {
      boss.stagger -= dt;
      return;
    }
    if (boss.charge) {
      boss.x = clamp(boss.x + boss.charge.vx * dt, boss.r, run.canvas.width - boss.r);
      boss.y = clamp(boss.y + boss.charge.vy * dt, boss.r, run.canvas.height - boss.r);
      boss.charge.time -= dt;
      if (!boss.charge.hit && circleHit(boss, run.you)) { boss.charge.hit = true; damagePlayer(run.tier.waveDamage * 0.75, run.you.x, run.you.y); }
      if (boss.charge.time <= 0) boss.charge = null;
      return;
    }

    const dx = you.x - boss.x;
    const dy = you.y - boss.y;
    const length = Math.hypot(dx, dy) || 1;
    boss.x += dx / length * tier.bossSpeed * dt;
    boss.y += dy / length * tier.bossSpeed * dt;

    if (boss.telegraph) {
      boss.telegraph.time -= dt;
      if (boss.telegraph.time <= 0) resolveBossAbility();
      return;
    }

    boss.abilityCooldown -= dt;
    if (boss.abilityCooldown <= 0 && !run.wave) beginBossAbility();
  }

  function updateDelayedEffects(dt) {
    for (const effect of run.delayedEffects) {
      effect.time -= dt;
      if (effect.time > 0) continue;
      if (effect.type === 'echoWave' && !run.wave) {
        run.wave = { r:28, speed:165, max:280, interacted:false, echo:true };
        emit('wave', { echo:true });
      }
      if (effect.type === 'chargeTelegraph' && !run.boss.telegraph) {
        run.boss.telegraph = { type:'charge', time:1, duration:1, targetX:run.you.x, targetY:run.you.y };
        emit('telegraph', { kind:'charge' });
      }
      if (effect.type === 'crossfire') {
        const origin = { x:run.canvas.width - run.boss.x, y:run.canvas.height - run.boss.y };
        fireVolley(1, 0, { x:effect.targetX, y:effect.targetY }, false, origin);
      }
      effect.done = true;
    }
    run.delayedEffects = run.delayedEffects.filter(effect => !effect.done);
  }

  function updateWave(dt) {
    if (!run.wave) return;
    const distance = Math.hypot(run.you.x - run.boss.x, run.you.y - run.boss.y);
    if (!run.wave.interacted && Math.abs(distance - run.wave.r) < 12) {
      run.wave.interacted = true;
      if (run.you.dash > 0) {
        run.stats.shockwavesEvaded += 1;
        if (hasTalent('guardedRecovery')) {
          run.you.hp = Math.min(run.you.maxHp, run.you.hp + 8);
          emit('talent', { talentId:'guardedRecovery' });
          if (hasTalent('aegis')) run.aegisArmed = true;
        }
        if (hasTalent('flowRecovery')) {
          run.you.dashCooldown = Math.max(0, run.you.dashCooldown - 0.4);
          spawnImpact(run.you.x, run.you.y, '#50d9ff', 10);
        }
      } else {
        damagePlayer(run.tier.waveDamage, run.you.x, run.you.y);
      }
    }
    run.wave.r += run.wave.speed * dt;
    if (run.wave.r > run.wave.max) run.wave = null;
  }

  function updatePlayerShots(dt) {
    for (const shot of run.shots) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.t += dt;
      if (!shot.hit && circleHit(shot, run.boss)) {
        shot.hit = true;
        damageBoss(shot.damage, { styleId: 'gun', x: shot.x, y: shot.y, dashStrike: shot.dashStrike });
        if (shot.pulse) {
          const before = run.enemyShots.length;
          run.enemyShots = run.enemyShots.filter(enemy => Math.hypot(enemy.x - shot.x, enemy.y - shot.y) > 110);
          run.stats.projectilesDeflected += before - run.enemyShots.length;
          spawnImpact(shot.x, shot.y, '#50d9ff', 14);
        }
        shot.t = 99;
      }
    }

    run.shots = run.shots.filter(shot => {
      const alive = shot.x > -20 && shot.x < run.canvas.width + 20 && shot.y > -20 && shot.y < run.canvas.height + 20 && shot.t < shot.lifetime;
      if (!alive && !shot.hit) resetPressure();
      return alive;
    });
  }

  function updateEnemyShots(dt) {
    for (const shot of run.enemyShots) {
      const stepX = shot.vx * dt;
      const stepY = shot.vy * dt;
      shot.x += stepX;
      shot.y += stepY;
      shot.distance += Math.hypot(stepX, stepY);
      shot.t += dt;
      if (shot.bounces > 0 && (shot.x <= shot.r || shot.x >= run.canvas.width - shot.r || shot.y <= shot.r || shot.y >= run.canvas.height - shot.r)) {
        if (shot.x <= shot.r || shot.x >= run.canvas.width - shot.r) shot.vx *= -1;
        if (shot.y <= shot.r || shot.y >= run.canvas.height - shot.r) shot.vy *= -1;
        shot.x = clamp(shot.x, shot.r + 1, run.canvas.width - shot.r - 1);
        shot.y = clamp(shot.y, shot.r + 1, run.canvas.height - shot.r - 1);
        shot.bounces -= 1;
      }
      if (shot.dropHazard && shot.distance >= shot.maxTravel) {
        run.hazards.push({ x:shot.x, y:shot.y, r:38, warning:0.6, life:3, hitCooldown:0 });
        shot.t = 99;
        continue;
      }
      if (circleHit(shot, run.you) && run.you.dash <= 0) {
        damagePlayer(shot.damage, shot.x, shot.y);
        shot.t = 99;
      }
    }
    run.enemyShots = run.enemyShots.filter(shot => shot.x > -20 && shot.x < run.canvas.width + 20 && shot.y > -20 && shot.y < run.canvas.height + 20 && shot.t < 5);
  }

  function updateHazards(dt) {
    for (const hazard of run.hazards) {
      hazard.warning = Math.max(0, hazard.warning - dt);
      hazard.life -= dt;
      if (hasDirective('encroachment') && hazard.warning <= 0) hazard.r = Math.min(125, hazard.r + 24 * dt);
      hazard.hitCooldown = Math.max(0, hazard.hitCooldown - dt);
      if (hazard.warning <= 0 && hazard.hitCooldown <= 0 && Math.hypot(run.you.x - hazard.x, run.you.y - hazard.y) < run.you.r + hazard.r) {
        if (damagePlayer(run.tier.projectileDamage * 0.6, run.you.x, run.you.y)) hazard.hitCooldown = 0.7;
      }
    }
    const expired = run.hazards.filter(hazard => hazard.life <= 0);
    if (hasDirective('chainReaction')) {
      for (const hazard of expired) {
        for (let i = 0; i < 4; i += 1) {
          const angle = i * Math.PI / 2;
          run.enemyShots.push({ x:hazard.x, y:hazard.y, r:5, vx:Math.cos(angle)*run.tier.projectileSpeed, vy:Math.sin(angle)*run.tier.projectileSpeed, damage:run.tier.projectileDamage*0.6, t:0, distance:0, dropHazard:false, maxTravel:Infinity, bounces:0, color:'#ff637d' });
        }
      }
    }
    run.hazards = run.hazards.filter(hazard => hazard.life > 0);
  }

  function updateFoodRegen(dt) {
    if (!run.foodRegen || run.foodRegen.remaining <= 0) return;
    const heal = Math.min(run.foodRegen.remaining, run.foodRegen.remaining / Math.max(0.01, run.foodRegen.duration) * dt);
    run.foodRegen.remaining -= heal;
    run.foodRegen.duration = Math.max(0, run.foodRegen.duration - dt);
    run.you.hp = Math.min(run.you.maxHp, run.you.hp + heal);
    if (run.foodRegen.remaining <= 0 || run.you.hp >= run.you.maxHp) run.foodRegen = null;
  }

  function updateRecovery(dt) {
    const you = run.you;
    if (!hasTalent('fortifiedRecovery') || run.fortifiedRecoveryUsed || you.recoveryTimer <= 0) return;
    you.recoveryTimer = Math.max(0, you.recoveryTimer - dt);
    if (you.recoveryTimer === 0 && you.hp < you.maxHp) {
      you.hp = Math.min(you.maxHp, you.hp + 25);
      run.fortifiedRecoveryUsed = true;
      run.stats.fortifiedRecoveryTriggered = true;
      emit('talent', { talentId:'fortifiedRecovery' });
      spawnImpact(you.x, you.y, '#62e6a7', 14);
    }
  }

  function updateMovement(dt) {
    const { you } = run;
    let x = 0;
    let y = 0;
    if (keysDown.KeyW) y -= 1;
    if (keysDown.KeyS) y += 1;
    if (keysDown.KeyA) x -= 1;
    if (keysDown.KeyD) x += 1;
    const speed = you.dash > 0 ? DASH_SPEED : PLAYER_SPEED * (you.slipstream > 0 ? 1.3 : 1);
    const length = Math.hypot(x, y) || 1;
    you.vx = x / length * speed;
    you.vy = y / length * speed;
    you.x = clamp(you.x + you.vx * dt, 20, run.canvas.width - 20);
    you.y = clamp(you.y + you.vy * dt, 20, run.canvas.height - 20);
    if (hasTalent('phaseRush') && you.dash > 0 && !run.phaseRushTriggered && circleHit(you, run.boss)) {
      run.phaseRushTriggered = true;
      run.boss.stagger = Math.max(run.boss.stagger, 0.6);
      emit('talent', { talentId:'phaseRush' });
      spawnImpact(run.boss.x, run.boss.y, '#50d9ff', 12);
    }
  }

  function drawTelegraph(ctx) {
    const telegraph = run.boss.telegraph;
    if (!telegraph) return;
    const progress = 1 - telegraph.time / telegraph.duration;
    if (telegraph.type === 'wave') {
      const radius = 32 + progress * 32;
      ctx.fillStyle = `rgba(255,80,80,${0.06 + progress * 0.12})`;
      ctx.strokeStyle = `rgba(255,99,125,${0.35 + progress * 0.6})`;
      ctx.lineWidth = 3 + progress * 3;
      ctx.beginPath();
      ctx.arc(run.boss.x, run.boss.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }

    ctx.strokeStyle = telegraph.type === 'aimed' ? '#ffad42' : '#ff637d';
    ctx.lineWidth = 2 + progress * 3;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(run.boss.x, run.boss.y);
    ctx.lineTo(telegraph.targetX, telegraph.targetY);
    ctx.stroke();
    if (telegraph.type === 'aimed' && hasDirective('ricochetProtocol')) {
      const dx = telegraph.targetX - run.boss.x, dy = telegraph.targetY - run.boss.y;
      ctx.beginPath(); ctx.moveTo(telegraph.targetX, telegraph.targetY);
      ctx.lineTo(clamp(telegraph.targetX - dx, 0, run.canvas.width), clamp(telegraph.targetY + dy, 0, run.canvas.height)); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function draw(ctx, dt) {
    ctx.clearRect(0, 0, run.canvas.width, run.canvas.height);
    drawTelegraph(ctx);

    if (run.wave) {
      ctx.strokeStyle = 'rgba(255,80,80,0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(run.boss.x, run.boss.y, run.wave.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (run.afterimage) {
      ctx.globalAlpha = clamp(run.afterimage.life, 0, 0.65);
      ctx.fillStyle = '#50d9ff';
      drawCircle(ctx, run.afterimage.x, run.afterimage.y, run.afterimage.r);
      ctx.globalAlpha = 1;
    }

    if (run.meleeSwing) {
      const halfArc = run.weapon.swingArcDeg * Math.PI / 360;
      ctx.strokeStyle = run.meleeSwing.hit ? 'rgba(255,200,87,.95)' : 'rgba(149,165,199,.65)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(run.you.x, run.you.y, run.weapon.range, run.meleeSwing.angle - halfArc, run.meleeSwing.angle + halfArc);
      ctx.stroke();
    }

    for (const particle of run.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
      ctx.globalAlpha = Math.max(0, particle.life * 3);
      ctx.fillStyle = particle.color;
      drawCircle(ctx, particle.x, particle.y, 2);
    }
    ctx.globalAlpha = 1;
    run.particles = run.particles.filter(particle => particle.life > 0);

    for (const hazard of run.hazards) {
      const warning = hazard.warning > 0;
      ctx.fillStyle = warning ? 'rgba(255,200,87,.10)' : 'rgba(255,99,125,.20)';
      ctx.strokeStyle = warning ? '#ffc857' : '#ff637d';
      ctx.lineWidth = warning ? 2 : 3;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, hazard.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    for (const shot of run.enemyShots) {
      ctx.fillStyle = shot.color;
      drawCircle(ctx, shot.x, shot.y, shot.r);
    }
    for (const shot of run.shots) {
      ctx.fillStyle = shot.pulse ? '#50d9ff' : '#c7d2ff';
      drawCircle(ctx, shot.x, shot.y, shot.r);
    }

    ctx.fillStyle = run.boss.hitFlash > 0 ? '#fff4cc' : '#ff5b5b';
    drawCircle(ctx, run.boss.x, run.boss.y, run.boss.r);
    ctx.fillStyle = run.you.hitFlash > 0 ? '#ffffff' : '#6df2a7';
    drawCircle(ctx, run.you.x, run.you.y, run.you.r);
  }

  function updateHud() {
    const { you, boss, elements } = run;
    elements.hpYou.textContent = `${Math.max(0, Math.ceil(you.hp))} / ${you.maxHp}`;
    elements.hpBoss.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
    elements.hpYouFill.style.width = `${clamp(you.hp / you.maxHp * 100, 0, 100)}%`;
    elements.hpBossFill.style.width = `${clamp(boss.hp / boss.maxHp * 100, 0, 100)}%`;
    elements.dashStatus.textContent = you.dashCooldown <= 0 ? 'READY' : `${you.dashCooldown.toFixed(1)}s`;
    elements.dashStatus.classList.toggle('ready', you.dashCooldown <= 0);

    const talentStatus = [];
    if (hasTalent('pressure')) talentStatus.push(`Pressure ${run.pressure}/${PRESSURE_MAX}`);
    if (hasTalent('cadence')) talentStatus.push(`Cadence ${run.cadenceHits}/3`);
    if (run.counterforceArmed) talentStatus.push('Counterforce ready');
    if (run.aegisArmed || run.foodShieldCharges > 0) talentStatus.push(`Barrier ${run.foodShieldCharges || 1}`);
    if (hasTalent('openingAttack') && !run.openingAttackUsed) talentStatus.push('Opening ready');
    if (hasTalent('dashStrike') && run.dashStrikeArmed && performance.now() <= run.dashStrikeUntil) talentStatus.push('Dash Strike ready');
    if (hasTalent('fortifiedRecovery') && !run.fortifiedRecoveryUsed && you.recoveryTimer > 0) talentStatus.push(`Recovery ${you.recoveryTimer.toFixed(1)}s`);
    elements.talentStatus.textContent = talentStatus.join(' · ') || 'No active talent trigger';
  }

  function finish(win, reason = win ? 'victory' : 'defeat') {
    if (!run || run.finished) return;
    run.finished = true;
    const result = {
      win,
      reason,
      tierId: run.tier.id,
      tierName: run.tier.name,
      weaponId: run.weapon.itemId,
      weaponName: run.weapon.name,
      styleId: run.weapon.styleId,
      duration: Math.max(0, (performance.now() - run.startedAt) / 1000),
      ...run.stats,
      directiveId:run.directiveId,
      carryState:{
        hp:run.you.hp, foodUsed:run.foodUsed,
        openingAttackUsed:run.openingAttackUsed, executionerUsed:run.executionerUsed,
        secondWindUsed:run.secondWindUsed, fortifiedRecoveryUsed:run.fortifiedRecoveryUsed,
        totalStartedAt:run.totalStartedAt
      }
    };
    emit(win ? 'victory' : 'defeat', { reason });
    const callback = run.onFinish;
    stop();
    callback(result);
  }

  function loop(now) {
    if (!run || run.finished) return;
    const dt = Math.min(0.033, (now - run.lastFrame) / 1000);
    run.lastFrame = now;
    const { you, boss } = run;

    you.attackCooldown = Math.max(0, you.attackCooldown - dt);
    you.dashCooldown = Math.max(0, you.dashCooldown - dt);
    you.dash = Math.max(0, you.dash - dt);
    you.hitFlash = Math.max(0, you.hitFlash - dt);
    you.hurtFxCooldown = Math.max(0, you.hurtFxCooldown - dt);
    you.slipstream = Math.max(0, you.slipstream - dt);
    you.ghostTimer = Math.max(0, you.ghostTimer - dt);
    boss.hitFlash = Math.max(0, boss.hitFlash - dt);
    if (run.afterimage) {
      run.afterimage.life -= dt;
      if (run.afterimage.life <= 0) run.afterimage = null;
    }
    if (run.meleeSwing) {
      run.meleeSwing.timeLeft -= dt;
      if (run.meleeSwing.timeLeft <= 0) run.meleeSwing = null;
    }

    updateMovement(dt);
    updateBoss(dt);
    updateDelayedEffects(dt);
    updateWave(dt);
    updateEnemyShots(dt);
    updateHazards(dt);
    updatePlayerShots(dt);
    updateFoodRegen(dt);
    updateRecovery(dt);

    if (circleHit(you, boss)) damagePlayer(run.tier.contactDps * dt, you.x, you.y);

    draw(run.ctx, dt);
    updateHud();

    if (!run.reduceMotion && run.shake > 0) {
      run.canvas.style.transform = `translate(${(Math.random() - 0.5) * run.shake}px, ${(Math.random() - 0.5) * run.shake}px)`;
      run.shake = Math.max(0, run.shake - 22 * dt);
    } else {
      run.canvas.style.transform = '';
    }

    if (you.hp <= 0) return finish(false);
    if (boss.hp <= 0) return finish(true);
    rafId = requestAnimationFrame(loop);
  }

  function onKeyDown(event) {
    if (!run) return;
    keysDown[event.code] = true;
    if (event.repeat) return;
    if (event.code === 'Space') {
      event.preventDefault();
      useDash();
    }
    if (event.code === 'KeyE') consumeFood(false);
  }

  function onKeyUp(event) {
    delete keysDown[event.code];
  }

  function onPointerDown(event) {
    if (!run) return;
    const rect = run.canvas.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) * run.canvas.width / rect.width;
    const mouseY = (event.clientY - rect.top) * run.canvas.height / rect.height;
    const dx = mouseX - run.you.x;
    const dy = mouseY - run.you.y;
    if (run.weapon.styleId === 'melee') meleeAttack(Math.atan2(dy, dx));
    if (run.weapon.styleId === 'gun') gunAttack(dx, dy);
  }

  function stop() {
    if (!run) return;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    run.canvas.removeEventListener('pointerdown', onPointerDown);
    Object.keys(keysDown).forEach(code => delete keysDown[code]);
    run.canvas.style.transform = '';
    run.elements.modal.style.display = 'none';
    run = null;
    rafId = null;
  }

  function start(config) {
    stop();
    const canvas = config.canvas;
    const maxHp = config.maxHp;
    const now = performance.now();
    run = {
      canvas,
      ctx: canvas.getContext('2d'),
      tier: config.tier,
      mode: config.mode || 'standard',
      directiveId: config.directiveId || null,
      reduceMotion: Boolean(config.reduceMotion),
      onEvent: config.onEvent,
      weapon: Object.freeze({ ...config.weapon }),
      talents: new Set(config.talents || []),
      consumeFood: config.consumeFood,
      onFinish: config.onFinish,
      elements: config.elements,
      you: {
        x: 120, y: 210, r: 14, vx: 0, vy: 0,
        maxHp, hp: clamp(config.carryState?.hp ?? maxHp, 0, maxHp), dash: 0, dashCooldown: 0, attackCooldown: 0,
        hitFlash: 0, hurtFxCooldown: 0, recoveryTimer: 0, slipstream:0, ghostTimer:0
      },
      boss: {
        x: 560, y: 210, r: 28,
        maxHp: config.tier.bossHp, hp: config.tier.bossHp,
        hitFlash: 0, stagger: 0, abilityCooldown: 1.5,
        telegraph: null, patternIndex: 0
      },
      shots: [], enemyShots: [], hazards: [], particles: [], wave: null, delayedEffects:[], foodRegen:null,
      meleeSwing: null, afterimage: null,
      food: config.food || null,
      foodUsed: Boolean(config.carryState?.foodUsed),
      pressure: 0,
      cadenceHits:0,
      foodShieldCharges:0,
      counterforceArmed:false,
      aegisArmed:false,
      phaseRushTriggered:false,
      gunSequence: 0,
      dashStrikeArmed: false,
      dashStrikeUntil: 0,
      openingAttackUsed: Boolean(config.carryState?.openingAttackUsed),
      executionerUsed: Boolean(config.carryState?.executionerUsed),
      secondWindUsed: Boolean(config.carryState?.secondWindUsed),
      fortifiedRecoveryUsed: Boolean(config.carryState?.fortifiedRecoveryUsed),
      shake: 0,
      startedAt: now,
      totalStartedAt: config.carryState?.totalStartedAt || now,
      lastFrame: now,
      finished: false,
      stats: {
        damageDealt: 0,
        damageTaken: 0,
        dashesUsed: 0,
        foodConsumed: 0,
        shockwavesEvaded: 0,
        projectilesDeflected: 0,
        highestPressure: 0,
        dashStrikeHits: 0,
        openingAttackTriggered: false,
        executionerTriggered: false,
        secondWindTriggered: false,
        fortifiedRecoveryTriggered: false
      }
    };

    run.elements.modal.style.display = 'flex';
    run.elements.controls.textContent = run.weapon.styleId === 'melee'
      ? 'WASD move · Space dash · Click swing/deflect · E eat equipped food'
      : 'WASD move · Space dash · Click shoot · Every fifth shot disrupts nearby projectiles · E eat';
    run.elements.foodStatus.textContent = run.food && !run.foodUsed ? `Food: ${run.food.name} ready (${run.food.instantHeal} HP${run.food.resetDash ? ' + Dash reset' : run.food.regenHeal ? ` + ${run.food.regenHeal} regeneration` : ''})` : run.foodUsed ? 'Food already consumed this run' : 'Food: none available';
    run.elements.tip.textContent = config.tier.id === 1
      ? 'Initiate: dash through the radial shockwave'
      : config.tier.id === 2
        ? 'Vanguard: sidestep the locked aim line and watch for shockwaves'
        : 'Apex: spread volleys leave temporary danger zones and alternate with shockwaves';

    window.addEventListener('keydown', onKeyDown, false);
    window.addEventListener('keyup', onKeyUp, false);
    canvas.addEventListener('pointerdown', onPointerDown, false);
    rafId = requestAnimationFrame(loop);
  }

  window.MomentumArena = Object.freeze({
    start,
    stop,
    giveUp() { if (run) finish(false, 'gaveUp'); },
    isRunning() { return Boolean(run); }
  });
})();
