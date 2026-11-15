// Bot AI: nine fighters on two teams. Defenders walk to a hold and watch a
// lane; attackers push a lane toward the Pier site along the waypoint graph.
// A bot that sees an enemy stops, aims after a human reaction delay, and fires
// in bursts; gunfire and explosions are heard, and the nearest bots turn to
// investigate. The carrier plants when the site is clear; defenders defuse
// when the charge is down. Movement uses the same moveBox as the player.
import * as THREE from 'three';
import { createWeaponState, fireShot, hasLineOfSight, WEAPONS } from './weapons.js';
import { moveBox } from './player.js';

const BOT_SPEED = 4.3;
const BOT_AIM_SPEED = 2.2;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE = 1.55;
const SEE_RANGE = 42;
const SEE_HALF_FOV = 1.0;
const HEAR_RADIUS = 18;

const NAMES_VAN = ['Rook', 'Mira', 'Sable', 'Ivo'];
const NAMES_SEN = ['Ash', 'Koda', 'Vex', 'Noor', 'Pike'];
const LANES = ['west', 'mid', 'east', 'mid', 'west'];
const HOLD_NODES = { west: 6, mid: 3, east: 9 };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildMesh(team) {
  const group = new THREE.Group();
  const suit = team === 'van' ? 0x2e5f6b : 0x8a4a2e;
  const accent = team === 'van' ? 0x7fc4d1 : 0xe08a7a;
  const bodyMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1d28, roughness: 0.9 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6, emissive: accent, emissiveIntensity: 0.25 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.05, 0.38), bodyMat);
  body.position.y = 0.88;
  body.castShadow = true;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.42), accentMat);
  chest.position.set(0, 1.12, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), bodyMat);
  head.position.y = 1.58;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), darkMat);
  visor.position.set(0, 1.6, -0.18);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), darkMat);
  gun.position.set(0.22, 1.18, -0.3);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.26), darkMat);
  legL.position.set(-0.16, 0.2, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  group.add(body, chest, head, visor, gun, legL, legR);
  // Health bar above the head: a dark backer and a bar that shrinks.
  const barBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x10121c }));
  barBack.position.y = 1.92;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.03),
    new THREE.MeshBasicMaterial({ color: team === 'van' ? 0x7fc4d1 : 0xe08a7a }));
  bar.position.y = 1.92;
  group.add(barBack, bar);
  return { group, bar, head, gun };
}

export function createBots(scene, map, effects, audio, seed = 1) {
  const rng = mulberry32(seed);
  const colliders = map.colliders;
  const bots = [];

  function makeBot(team, name, lane, spawn, weaponId) {
    const parts = buildMesh(team);
    scene.add(parts.group);
    const bot = {
      id: `${team}-${name}`,
      name,
      team,
      lane,
      parts,
      position: spawn.clone(),
      velocity: new THREE.Vector3(),
      yaw: team === 'van' ? Math.PI : 0,
      health: 100,
      alive: true,
      weapon: createWeaponState(weaponId),
      state: 'route',
      path: [],
      pathIdx: 0,
      holdNode: HOLD_NODES[lane] ?? 3,
      target: null,
      lastSeen: new THREE.Vector3(),
      lastSeenTime: -99,
      reaction: 0,
      burstLeft: 0,
      burstTimer: 0,
      hearPos: null,
      hearTime: -99,
      plantProgress: 0,
      defuseProgress: 0,
      isCarrier: false,
      perceiveAt: rng() * 0.15,
      fallT: 0,
      walkPhase: rng() * 6,
      headBox(box) {
        box.min.set(this.position.x - 0.2, this.position.y + 1.42, this.position.z - 0.2);
        box.max.set(this.position.x + 0.2, this.position.y + 1.76, this.position.z + 0.2);
        return box;
      },
      bodyBox(box) {
        box.min.set(this.position.x - 0.36, this.position.y + 0.1, this.position.z - 0.24);
        box.max.set(this.position.x + 0.36, this.position.y + 1.42, this.position.z + 0.24);
        return box;
      },
      eyePos(out) {
        return out.set(this.position.x, this.position.y + EYE, this.position.z);
      },
    };
    bots.push(bot);
    return bot;
  }

  const spawns = map.spawnBots;
  NAMES_VAN.forEach((name, i) => {
    const bot = makeBot('van', name, LANES[i], new THREE.Vector3(-14 + i * 7, 0, 14), i === 2 ? 'smg' : 'rifle');
    bot.path = map.findPath(bot.position, map.site.center);
  });
  NAMES_SEN.forEach((name, i) => {
    const bot = makeBot('sen', name, LANES[i], spawns[i % spawns.length], i === 1 ? 'smg' : 'rifle');
    bot.path = map.findPath(bot.position, map.waypoints[bot.holdNode]);
  });
  // The first Vanguard bot carries the charge into the round.
  bots.find((b) => b.team === 'van').isCarrier = true;

  function resetRound() {
    for (const bot of bots) {
      bot.health = 100;
      bot.alive = true;
      bot.state = 'route';
      bot.fallT = 0;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.target = null;
      bot.burstLeft = 0;
      bot.parts.group.rotation.x = 0;
      bot.parts.group.visible = true;
      bot.parts.bar.scale.x = 1;
      if (bot.team === 'van') {
        const i = NAMES_VAN.indexOf(bot.name);
        bot.position.set(-14 + i * 7, 0, 14);
        bot.yaw = Math.PI;
        bot.path = map.findPath(bot.position, map.site.center);
      } else {
        const i = NAMES_SEN.indexOf(bot.name);
        bot.position.copy(map.spawnBots[i % map.spawnBots.length]);
        bot.yaw = 0;
        bot.path = map.findPath(bot.position, map.waypoints[bot.holdNode]);
      }
      bot.weapon = createWeaponState(bot.weapon.def.id);
      bot.isCarrier = false;
    }
    bots.find((b) => b.team === 'van').isCarrier = true;
  }

  function onNoise(position, radius, time) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      if (bot.position.distanceTo(position) <= radius) {
        bot.hearPos = position.clone();
        bot.hearTime = time;
      }
    }
  }

  function visibleEnemy(bot, enemies, time) {
    let best = null;
    let bestScore = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      _v1.set(enemy.position.x, enemy.position.y + 1.2, enemy.position.z);
      bot.eyePos(_v2);
      const dist = _v1.distanceTo(_v2);
      if (dist > SEE_RANGE) continue;
      _toTarget.subVectors(_v1, _v2).normalize();
      _fwd.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (_fwd.dot(_toTarget) < Math.cos(SEE_HALF_FOV) && dist > 6) continue;
      if (!hasLineOfSight(colliders, _v2, _v1)) continue;
      const score = dist;
      if (score < bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    if (best) {
      bot.lastSeen.set(best.position.x, best.position.y + 1.2, best.position.z);
      bot.lastSeenTime = time;
    }
    return best;
  }

  function shootAt(bot, target, time, ctx) {
    const w = bot.weapon;
    if (!w.canFire(time)) return;
    const spread = 2.2 + bot.lastSeen.distanceTo(bot.position) * 0.045 + (bot.state === 'engage' ? 0 : 1.5);
    bot.eyePos(_v1);
    _v1.y += 0.05;
    _toTarget.set(target.position.x, target.position.y + 1.15, target.position.z).sub(_v1).normalize();
    const foes = target.isPlayer ? [target] : ctx.bots.filter((b) => b.team !== bot.team && b.alive);
    const shot = fireShot(colliders, foes, _v1, _toTarget, w.def, spread, rng);
    w.lastShot = time;
    w.mag -= 1;
    w.bloom = Math.min(2.4, w.bloom + 0.35);
    const muzzle = _v2.copy(_v1).addScaledVector(_toTarget, 0.7);
    effects.tracer(muzzle, shot.point);
    effects.muzzle(muzzle);
    audio.shot(true);
    ctx.onNoise(_v1, 18, time);
    if (shot.hit === 'head' || shot.hit === 'body') {
      const scale = target.isPlayer ? 0.7 : 1.0;
      ctx.damage(target, shot.damage * scale, bot, shot.hit === 'head');
    } else if (shot.hit === 'map') {
      _fwd.copy(_toTarget);
      effects.impact(shot.point, _fwd.negate());
    }
    if (w.mag <= 0) w.startReload(time);
  }

  function followPath(bot, dt, speed) {
    if (bot.pathIdx >= bot.path.length) return true;
    const node = bot.path[bot.pathIdx];
    _v1.set(node.x - bot.position.x, 0, node.z - bot.position.z);
    const dist = _v1.length();
    if (dist < 0.6) {
      bot.pathIdx += 1;
      return bot.pathIdx >= bot.path.length;
    }
    _v1.multiplyScalar(1 / dist);
    const targetYaw = Math.atan2(-_v1.x, -_v1.z);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dy));
    bot.velocity.x = _v1.x * speed;
    bot.velocity.z = _v1.z * speed;
    bot.velocity.y -= 20 * dt;
    bot.onGround = moveBox(colliders, bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
    bot.walkPhase += dt * 9;
    return false;
  }

  function step(dt, time, ctx) {
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fallT < 1) {
          bot.fallT = Math.min(1, bot.fallT + dt * 3);
          bot.parts.group.rotation.x = -Math.PI / 2 * bot.fallT * 0.9;
          bot.parts.group.position.y = bot.position.y + 0.15 * bot.fallT;
        }
        continue;
      }
      const w = bot.weapon;
      if (w.reloading && time >= w.reloadEnd) {
        w.finishReload();
      }
      w.bloom = Math.max(0, w.bloom - dt * 2.2);

      // Perception, staggered so nine bots do not all raycast every tick.
      bot.perceiveAt -= dt;
      if (bot.perceiveAt <= 0) {
        bot.perceiveAt = 0.15 + rng() * 0.05;
        const enemies = bot.team === 'van'
          ? ctx.bots.filter((b) => b.team === 'sen' && b.alive)
          : ctx.bots.filter((b) => b.team === 'van' && b.alive);
        if (bot.team === 'sen') enemies.push(ctx.player);
        const seen = visibleEnemy(bot, enemies, time);
        if (seen) {
          if (bot.target !== seen) {
            bot.target = seen;
            bot.reaction = 0.25 + rng() * 0.3;
            bot.burstLeft = 0;
          }
          bot.state = 'engage';
        } else if (bot.state === 'engage' && time - bot.lastSeenTime > 2.2) {
          bot.target = null;
          bot.state = 'route';
          if (bot.team === 'sen') {
            bot.path = map.findPath(bot.position, map.waypoints[bot.holdNode]);
            bot.pathIdx = 0;
          } else {
            bot.path = map.findPath(bot.position, map.site.center);
            bot.pathIdx = 0;
          }
        }
      }

      // Bomb logic overrides routing for the carrier and for defenders.
      if (bot.team === 'van' && bot.isCarrier && ctx.bomb.state === 'carried' && ctx.bomb.carrier === bot) {
        const inSite = bot.position.distanceTo(map.site.center) < map.site.radius;
        if (inSite && bot.state !== 'engage') {
          bot.state = 'plant';
        }
      }
      if (bot.team === 'sen' && ctx.bomb.state === 'planted') {
        const d = bot.position.distanceTo(ctx.bomb.position);
        if (d > 1.6 && bot.state !== 'engage') {
          if (bot.state !== 'defuse') {
            bot.path = map.findPath(bot.position, ctx.bomb.position);
            bot.pathIdx = 0;
            bot.state = 'defuse';
          }
        }
      }

      if (bot.state === 'engage' && bot.target && bot.target.alive) {
        // Face the target, then fire in bursts after the reaction delay.
        _v1.set(bot.target.position.x - bot.position.x, 0, bot.target.position.z - bot.position.z);
        const targetYaw = Math.atan2(-_v1.x, -_v1.z);
        let dy = targetYaw - bot.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        bot.yaw += Math.max(-4.5 * dt, Math.min(4.5 * dt, dy));
        bot.velocity.x = 0;
        bot.velocity.z = 0;
        bot.velocity.y -= 20 * dt;
        bot.onGround = moveBox(colliders, bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
        if (bot.reaction > 0) {
          bot.reaction -= dt;
        } else {
          if (bot.burstLeft <= 0) {
            bot.burstLeft = 3 + Math.floor(rng() * 3);
            bot.burstTimer = 0.55 + rng() * 0.5;
          }
          bot.burstTimer -= dt;
          if (bot.burstTimer <= 0 && bot.burstLeft > 0) {
            bot.burstTimer = 0.13;
            bot.burstLeft -= 1;
            shootAt(bot, bot.target, time, ctx);
          }
        }
      } else if (bot.state === 'plant') {
        bot.velocity.x = 0;
        bot.velocity.z = 0;
        bot.velocity.y -= 20 * dt;
        bot.onGround = moveBox(colliders, bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
        bot.plantProgress += dt / 3.5;
        if (bot.plantProgress >= 1) {
          bot.plantProgress = 0;
          ctx.onPlant(bot);
        }
      } else if (bot.state === 'defuse' && ctx.bomb.state === 'planted') {
        if (bot.position.distanceTo(ctx.bomb.position) <= 1.6) {
          bot.velocity.x = 0;
          bot.velocity.z = 0;
          bot.velocity.y -= 20 * dt;
          bot.onGround = moveBox(colliders, bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
          bot.defuseProgress += dt / 5;
          if (bot.defuseProgress >= 1) {
            bot.defuseProgress = 0;
            ctx.onDefuse(bot);
          }
        } else {
          followPath(bot, dt, BOT_SPEED);
        }
      } else if (bot.state === 'hold' || (bot.team === 'sen' && bot.pathIdx >= bot.path.length && bot.state === 'route')) {
        // Defenders hold their angle, scanning slowly.
        bot.state = 'hold';
        bot.velocity.x = 0;
        bot.velocity.z = 0;
        bot.velocity.y -= 20 * dt;
        bot.onGround = moveBox(colliders, bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
        bot.yaw += Math.sin(time * 0.5 + bot.walkPhase) * dt * 0.35;
        if (bot.hearPos && time - bot.hearTime < 3) {
          _v1.set(bot.hearPos.x - bot.position.x, 0, bot.hearPos.z - bot.position.z);
          bot.yaw = Math.atan2(-_v1.x, -_v1.z);
        }
      } else {
        const arrived = followPath(bot, dt, bot.state === 'engage' ? BOT_AIM_SPEED : BOT_SPEED);
        if (arrived && bot.team === 'sen') bot.state = 'hold';
      }

      // Sync the mesh: position, facing, gun, health bar.
      bot.parts.group.position.copy(bot.position);
      bot.parts.group.rotation.y = bot.yaw;
      const hp = Math.max(0, bot.health / 100);
      bot.parts.bar.scale.x = Math.max(0.02, hp);
      bot.parts.bar.position.x = -(1 - hp) * 0.33;
      bot.parts.bar.material.color.setHex(hp > 0.5 ? 0x7fc4d1 : hp > 0.25 ? 0xffb347 : 0xc65b4e);
    }
  }

  function applyDamage(bot, amount, attacker, isHead) {
    if (!bot.alive) return;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.fallT = 0;
    }
  }

  return {
    bots,
    step,
    resetRound,
    onNoise,
    applyDamage,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    carrier() {
      return bots.find((b) => b.isCarrier && b.alive) ?? null;
    },
  };
}
