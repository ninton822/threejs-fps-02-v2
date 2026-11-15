// Dusk Harbor: a round-based tactical FPS. One state object (G) holds the
// match; a fixed-step simulation (1/60 s) runs the player, the bots, the
// weapons and the rounds, and rendering only reads state. Nothing is
// allocated in the hot loop: every vector below is a module temp.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createPlayer, moveBox } from './player.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createRounds, BUY_TIME } from './rounds.js';
import { WEAPONS, createWeaponState, fireShot, hasLineOfSight, createGrenade, GRENADE_PRICE, GRENADE_MAX, GRENADE_RADIUS, GRENADE_DAMAGE } from './weapons.js';
import { createHud } from './hud.js';
import { createTouchControls, IS_TOUCH } from './touch.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';
const SEED = Number(params.get('seed') || 1);

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
const rng = mulberry32(SEED * 7919 + 13);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _probe = new THREE.Box3();

// ----- renderer / scene -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 26, 60);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);

const map = createMap(scene);
const audio = createAudio();
const effects = createEffects(scene);
const player = createPlayer(map.colliders);

// ----- viewmodel: the gun in the player's hands -------------------------
const viewGun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d28, roughness: 0.55, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x8a4a2e, roughness: 0.6, metalness: 0.3 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.46), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), dark);
  barrel.position.set(0, 0.03, -0.34);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.09), accent);
  grip.position.set(0, -0.13, 0.14);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), accent);
  sight.position.set(0, 0.1, -0.05);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), dark);
  mag.position.set(0, -0.12, -0.05);
  viewGun.add(receiver, barrel, grip, sight, mag);
  viewGun.position.set(0.24, -0.22, -0.5);
  camera.add(viewGun);
}
const muzzleTip = new THREE.Object3D();
muzzleTip.position.set(0, 0.03, -0.62);
viewGun.add(muzzleTip);

// ----- the charge: a small case with a blinking lamp --------------------
const bombMesh = new THREE.Group();
{
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1a1d28, roughness: 0.5, metalness: 0.5 }));
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }));
  lamp.position.y = 0.12;
  bombMesh.add(caseMesh, lamp);
  bombMesh.visible = false;
  scene.add(bombMesh);
}
const bombLamp = bombMesh.children[1];

// ----- single state store ------------------------------------------------
const G = {
  phase: 'menu', // menu | buy | live | end | matchEnd
  paused: false,
  time: 0,
  health: 100,
  alive: true,
  spectating: false,
  money: 800,
  owned: ['pistol'],
  current: 'pistol',
  weapons: { pistol: createWeaponState('pistol') },
  grenades: 0,
  switching: 0,
  firing: false,
  fireEdge: false, // a queued semi-auto shot from a tap shorter than a frame
  keys: new Set(),
  yaw: 0,
  pitch: 0,
  bobPhase: 0,
  plantHolding: false,
  defuseHolding: false,
  grenadeFlight: null,
  shotMode: SHOT,
};

const rounds = createRounds({
  // playerTarget is set on the rounds object below, once it exists;
  // startRound reads the bomb carrier from there, not from this config.
  aliveCount: (team) => {
    let n = team === 'van' ? (G.alive ? 1 : 0) : 0;
    return n + bots.aliveCount(team);
  },
  onRoundStart: (round) => {
    G.phase = 'buy';
    hud.hideRoundEnd();
    hud.showBuy(round, BUY_TIME);
    hud.renderBuy(G.money, { weapons: G.owned, grenades: G.grenades }, buyItem);
  },
  onLive: () => {
    // G.phase is the gate for player movement, shooting and the plant
    // channel: rounds.phase alone going live is not enough. Without this
    // line the player can never move or fire in a real match (only the
    // ?shot=play screenshot mode set it).
    G.phase = 'live';
    hud.hideBuy();
    hud.banner('Round live', 'Plant the charge at the Pier — or clear the site.', null);
  },
  onRoundEnd: (winner, reason, playerWon) => {
    G.phase = 'end';
    const s = rounds;
    hud.showRoundEnd(
      playerWon ? 'Round won' : 'Round lost',
      reason,
      `<b>Score</b> Vanguard ${s.scoreVan} — ${s.scoreSen} Sentinel &nbsp;·&nbsp; <b>Round</b> ${s.round} / 9<br>` +
      `<b>You</b> ${s.kills} kills · ${s.deaths} deaths · ${s.plants} plants · $${G.money}`,
    );
    if (playerWon) audio.roundWin(); else audio.roundLose();
  },
  onMatchEnd: (winner) => {
    G.phase = 'matchEnd';
    const won = winner === 'van';
    hud.showMatchEnd(
      won ? 'Match won — Vanguard takes the Harbor' : 'Match lost — Sentinel holds the Harbor',
      `Final score: Vanguard ${rounds.scoreVan} — ${rounds.scoreSen} Sentinel.`,
      `<b>You</b> ${rounds.kills} kills · ${rounds.deaths} deaths · ${rounds.plants} plants · ${rounds.defuses} defuses`,
    );
    if (won) audio.roundWin(); else audio.roundLose();
  },
  onRoundReset: () => {
    resetPositions();
  },
  onDetonate: () => {
    effects.explosion(_v1.copy(rounds.bomb.position).setY(0.6));
    audio.explosion();
  },
  onPlanted: (by) => {
    bombMesh.visible = true;
    bombMesh.position.copy(rounds.bomb.position);
    audio.plantBeep(true);
    hud.banner('Charge planted', 'Sentinel has 35 seconds to defuse it.', null);
  },
  onDefused: () => {
    bombMesh.visible = false;
    audio.plantBeep(true);
  },
  onBombDropped: (pos) => {
    bombMesh.visible = true;
    bombMesh.position.copy(pos);
  },
  onBombPickedUp: (who) => {
    if (who.isPlayer) {
      bombMesh.visible = false;
      hud.banner('Charge recovered', 'Plant it at the Pier.', null);
    } else {
      bombMesh.visible = false;
    }
  },
});

// The player as a target for bot fire: head and body boxes from the
// player's live position and height, so crouching shrinks the hitbox.
const playerTarget = {
  isPlayer: true,
  name: 'You',
  team: 'van',
  get alive() { return G.alive; },
  get position() { return player.state.position; },
  headBox(box) {
    const p = player.state.position;
    const h = player.state.height;
    box.min.set(p.x - 0.2, p.y + h - 0.3, p.z - 0.2);
    box.max.set(p.x + 0.2, p.y + h + 0.04, p.z + 0.2);
    return box;
  },
  bodyBox(box) {
    const p = player.state.position;
    const h = player.state.height;
    box.min.set(p.x - 0.36, p.y + 0.1, p.z - 0.24);
    box.max.set(p.x + 0.36, p.y + h - 0.3, p.z + 0.24);
    return box;
  },
};
rounds.playerTarget = playerTarget; // startRound reads the bomb carrier from here

const bots = createBots(scene, map, effects, audio, SEED);
const hud = createHud({});

// ----- bot context: damage routing, noise, bomb --------------------------
function damageFighter(target, amount, attacker, isHead) {
  if (target.isPlayer) {
    if (!G.alive) return;
    G.health -= amount;
    hud.damageFlash();
    audio.hurt();
    if (G.health <= 0) {
      G.health = 0;
      G.alive = false;
      G.spectating = true;
      rounds.deaths += 1;
      rounds.dropBomb(player.state.position);
      // The player's loadout is lost on death, Counter-Strike style.
      G.owned = ['pistol'];
      G.weapons = { pistol: createWeaponState('pistol') };
      G.current = 'pistol';
      G.grenades = 0;
      hud.banner('You are down', 'Spectating — your team fights on.', false);
      document.exitPointerLock?.();
    }
    return;
  }
  const before = target.health;
  bots.applyDamage(target, amount, attacker, isHead);
  if (target.alive) {
    // A hurt bot turns toward the shooter.
    if (attacker && attacker.isPlayer) {
      target.hearPos = player.state.position.clone();
      target.hearTime = G.time;
    }
  } else if (before > 0) {
    const killer = attacker && attacker.isPlayer ? 'You' : attacker ? attacker.name : 'Unknown';
    const killerTeam = attacker && attacker.isPlayer ? 'van' : attacker ? attacker.team : 'van';
    hud.killfeed(killer, target.name, attacker && attacker.isPlayer ? currentWeapon().def.name : (attacker ? attacker.weapon.def.name : '—'), isHead);
    hud.hitmarker(true);
    if (attacker && attacker.isPlayer) {
      G.money += 300;
      rounds.kills += 1;
      audio.hit(true);
    }
  }
}

const botCtx = {
  bots: bots.bots,
  player: playerTarget,
  bomb: rounds.bomb,
  damage: damageFighter,
  onNoise: (pos, radius, time) => bots.onNoise(pos, radius, time),
  onPlant: (bot) => { rounds.plant(bot); },
  onDefuse: (bot) => { rounds.defuse(bot); },
};

function currentWeapon() {
  return G.weapons[G.current];
}

function resetPositions() {
  player.reset(map.spawnPlayer.x, map.spawnPlayer.z, 0);
  G.health = 100;
  G.alive = true;
  G.spectating = false;
  G.yaw = 0;
  G.pitch = 0;
  G.grenadeFlight = null;
  bombMesh.visible = false;
  for (const id of G.owned) {
    if (G.weapons[id]) G.weapons[id].topUpReserve();
  }
  bots.resetRound();
  if (!G.weapons[G.current]) {
    G.current = 'pistol';
  }
}

function buyItem(id) {
  if (rounds.phase !== 'buy') return;
  if (id === 'ammo') {
    if (G.money < 200) return;
    G.money -= 200;
    for (const wid of G.owned) G.weapons[wid].topUpReserve();
    audio.buy();
  } else if (id === 'grenade') {
    if (G.money < GRENADE_PRICE || G.grenades >= GRENADE_MAX) return;
    G.money -= GRENADE_PRICE;
    G.grenades = GRENADE_MAX;
    audio.buy();
  } else {
    const def = WEAPONS[id];
    if (!def || G.money < def.price || G.owned.includes(id)) return;
    G.money -= def.price;
    G.owned.push(id);
    G.weapons[id] = createWeaponState(id);
    G.current = id;
    G.switching = 0.4;
    audio.buy();
  }
  hud.renderBuy(G.money, { weapons: G.owned, grenades: G.grenades }, buyItem);
}

// ----- shooting -----------------------------------------------------------
function cameraForward(out) {
  const cp = Math.cos(player.state.pitch);
  return out.set(-Math.sin(player.state.yaw) * cp, Math.sin(player.state.pitch), -Math.cos(player.state.yaw) * cp);
}

function eyePos(out) {
  const p = player.state;
  return out.set(p.position.x, p.position.y + p.eye, p.position.z);
}

function playerShoot(now) {
  const w = currentWeapon();
  if (!w.canFire(now) || G.switching > 0) return;
  const moving = player.groundSpeed() > 0.8;
  const spread = w.spreadDeg(moving, !player.state.onGround, player.state.crouching);
  eyePos(_eye);
  cameraForward(_fwd);
  const foes = bots.bots.filter((b) => b.team === 'sen' && b.alive);
  const shot = fireShot(map.colliders, foes, _eye, _fwd, w.def, spread, rng);
  w.lastShot = now;
  w.mag -= 1;
  w.bloom = Math.min(2.6, w.bloom + (w.def.id === 'rifle' ? 0.5 : 0.35));
  // Recoil kicks the aim up with a small random yaw.
  player.recoil(w.def.recoil * (Math.PI / 180) * (1 + w.bloom * 0.12), (rng() - 0.5) * w.def.recoil * 0.4 * (Math.PI / 180));
  muzzleTip.getWorldPosition(_muzzle);
  effects.tracer(_muzzle, shot.point);
  effects.muzzle(_muzzle);
  audio.shot(false);
  bots.onNoise(_eye, 18, now);
  if (shot.hit === 'head' || shot.hit === 'body') {
    hud.hitmarker(false);
    audio.hit(false);
    damageFighter(shot.target, shot.damage, playerTarget, shot.hit === 'head');
  } else if (shot.hit === 'map') {
    _v1.copy(_fwd).negate();
    effects.impact(shot.point, _v1);
  }
  if (w.mag <= 0) {
    if (w.startReload(now)) audio.reload();
  }
  viewGun.position.z = -0.5 + 0.07;
}

function throwGrenade() {
  if (G.grenades <= 0 || G.grenadeFlight || rounds.phase !== 'live') return;
  G.grenades -= 1;
  eyePos(_eye);
  cameraForward(_fwd);
  G.grenadeFlight = createGrenade(_eye, _fwd, playerTarget);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1d28, roughness: 0.4, metalness: 0.6 }));
  mesh.position.copy(G.grenadeFlight.position);
  scene.add(mesh);
  G.grenadeFlight.mesh = mesh;
  audio.click();
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  effects.explosion(g.position);
  effects.smoke(g.position);
  audio.explosion();
  bots.onNoise(g.position, 26, G.time);
  // The frag is keyed to Sentinel: it hurts defenders, the thrower at half
  // strength if they stand too close, never their own teammates.
  for (const bot of bots.bots) {
    if (!bot.alive || bot.team !== 'sen') continue;
    const d = bot.position.distanceTo(g.position);
    if (d > GRENADE_RADIUS) continue;
    const dmg = Math.round(GRENADE_DAMAGE * (1 - d / (GRENADE_RADIUS + 2)));
    damageFighter(bot, dmg, playerTarget, false);
  }
  const pd = player.state.position.distanceTo(g.position);
  if (pd < GRENADE_RADIUS && G.alive) {
    damageFighter(playerTarget, Math.round(GRENADE_DAMAGE * 0.5 * (1 - pd / (GRENADE_RADIUS + 2))), null, false);
  }
}

function stepGrenade(dt) {
  const g = G.grenadeFlight;
  if (!g) return;
  g.fuse -= dt;
  g.velocity.y -= 20 * dt;
  // Axis-separated bounce against the map, 0.4 restitution.
  _probe.min.set(g.position.x - 0.09, g.position.y - 0.09, g.position.z - 0.09);
  _probe.max.set(g.position.x + 0.09, g.position.y + 0.09, g.position.z + 0.09);
  const nx = g.position.x + g.velocity.x * dt;
  _probe.min.x = nx - 0.09; _probe.max.x = nx + 0.09;
  let hitX = false;
  for (const c of map.colliders) if (_probe.intersectsBox(c)) { hitX = true; break; }
  if (hitX) g.velocity.x *= -0.4; else g.position.x = nx;
  const nz = g.position.z + g.velocity.z * dt;
  _probe.min.x = g.position.x - 0.09; _probe.max.x = g.position.x + 0.09;
  _probe.min.z = nz - 0.09; _probe.max.z = nz + 0.09;
  let hitZ = false;
  for (const c of map.colliders) if (_probe.intersectsBox(c)) { hitZ = true; break; }
  if (hitZ) g.velocity.z *= -0.4; else g.position.z = nz;
  const ny = g.position.y + g.velocity.y * dt;
  _probe.min.z = g.position.z - 0.09; _probe.max.z = g.position.z + 0.09;
  _probe.min.y = ny - 0.09; _probe.max.y = ny + 0.09;
  let hitY = false;
  for (const c of map.colliders) if (_probe.intersectsBox(c)) { hitY = true; break; }
  if (hitY) {
    g.velocity.y = Math.abs(g.velocity.y) * 0.4;
    if (g.velocity.y < 0.8) g.velocity.y = 0;
  } else {
    g.position.y = ny;
  }
  if (g.position.y < 0.09) {
    g.position.y = 0.09;
    g.velocity.y = Math.abs(g.velocity.y) * 0.4;
  }
  g.mesh.position.copy(g.position);
  if (g.fuse <= 0) {
    G.grenadeFlight = null;
    explodeGrenade(g);
  }
}

// ----- plant / defuse channel ---------------------------------------------
function stepChannel(dt) {
  const inSite = player.state.position.distanceTo(map.site.center) < map.site.radius;
  const bomb = rounds.bomb;
  if (G.alive && rounds.phase === 'live' && G.keys.has('KeyE')) {
    if (bomb.state === 'carried' && bomb.carrier === playerTarget && inSite) {
      bomb.plantProgress += dt / 3.5;
      if (bomb.plantProgress >= 1) {
        bomb.plantProgress = 0;
        rounds.plant(playerTarget);
        audio.plantBeep(true);
      }
      return bomb.plantProgress;
    }
  }
  // Letting go of E bleeds the channel away.
  if (bomb.plantProgress > 0) bomb.plantProgress = Math.max(0, bomb.plantProgress - dt / 2);
  return -1;
}

// ----- input ---------------------------------------------------------------
const canvas = renderer.domElement;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  G.keys.add(e.code);
  if (e.code === 'KeyR') {
    const w = currentWeapon();
    if (w.startReload(G.time)) audio.reload();
  }
  if (e.code === 'Digit1') switchWeapon('pistol');
  if (e.code === 'Digit2') switchWeapon('smg');
  if (e.code === 'Digit3') switchWeapon('rifle');
  if (e.code === 'KeyG' || e.code === 'Digit4') throwGrenade();
  if (e.code === 'KeyB' && rounds.phase === 'buy') {
    hud.showBuy(rounds.round, rounds.phaseTime);
    hud.renderBuy(G.money, { weapons: G.owned, grenades: G.grenades }, buyItem);
    document.exitPointerLock?.();
  }
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => G.keys.delete(e.code));
addEventListener('blur', () => { G.keys.clear(); G.firing = false; });

function switchWeapon(id) {
  if (!G.owned.includes(id) || G.current === id || rounds.phase === 'menu') return;
  G.current = id;
  G.switching = 0.4;
  audio.click();
}

canvas.addEventListener('mousedown', (e) => {
  audio.unlock();
  if (G.phase !== 'live' || !G.alive) return;
  if (document.pointerLockElement !== canvas) {
    // Touch devices never take pointer lock: a tap is a look/joystick
    // touch, not a lock request.
    if (!IS_TOUCH) canvas.requestPointerLock();
    return;
  }
  if (e.button === 0) G.firing = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) G.firing = false;
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.look(e.movementX, e.movementY);
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && G.phase === 'live' && G.alive && !SHOT) {
    G.paused = true;
    hud.banner('Paused', 'Click Deploy to resume.', null);
    hud.showMenu();
    document.getElementById('deploy-btn').textContent = 'Resume';
  }
});

document.getElementById('deploy-btn').addEventListener('click', () => {
  audio.unlock();
  hud.hideAllOverlays();
  if (G.phase === 'menu') {
    rounds.startMatch();
    G.phase = 'buy';
  }
  G.paused = false;
  // Only lock the pointer when resuming a LIVE round. Starting a match
  // opens the buy menu, and a locked pointer makes every buy card and the
  // Deploy button unclickable until the player presses Esc.
  if (!IS_TOUCH && !SHOT && G.phase === 'live') canvas.requestPointerLock();
});
document.getElementById('buy-done').addEventListener('click', () => {
  hud.hideBuy();
  if (!IS_TOUCH && !SHOT) canvas.requestPointerLock();
});
document.getElementById('next-round-btn').addEventListener('click', () => {
  audio.unlock();
  hud.hideRoundEnd();
  rounds.nextRound();
  // Next round opens the buy menu: leave the pointer free so the player
  // can actually click the buy cards (lock comes from the Deploy button).
});
document.getElementById('restart-btn').addEventListener('click', () => {
  audio.unlock();
  hud.hideAllOverlays();
  rounds.startMatch();
  resetPositions();
  G.phase = 'buy';
  // Same as next-round: a fresh match opens the buy menu, so no lock here.
});

// Touch controls: only on touch devices. They feed the same key set and
// fire flag as the keyboard and mouse, and never request pointer lock.
const touch = IS_TOUCH ? createTouchControls({
  keys: G.keys,
  look: (dx, dy, sens) => player.look(dx, dy, sens),
  setFiring: (b) => { G.firing = b; },
  queueFire: () => { G.fireEdge = true; },
  reload: () => { const w = currentWeapon(); if (w.startReload(G.time)) audio.reload(); },
  switchWeapon,
  throwGrenade,
  unlock: () => audio.unlock(),
}) : null;

// ----- fixed-step simulation ------------------------------------------------
function simStep(dt) {
  G.time += dt;
  // A fire edge queued outside live play dies here, never as a stray shot
  // when the next round starts.
  if (G.phase !== 'live') G.fireEdge = false;
  const w = currentWeapon();
  if (w.reloading && G.time >= w.reloadEnd) {
    w.finishReload();
    audio.reload();
  }
  w.bloom = Math.max(0, w.bloom - dt * 2.4);
  if (G.switching > 0) G.switching -= dt;

  if (G.phase === 'live' && G.alive && !G.paused) {
    player.step(dt, G.keys);
    // A tap shorter than one frame still fires: the touch FIRE button
    // queues an edge the simulation consumes, so a quick tap is never
    // lost between frames (headless SwiftShader runs ~5 fps; a real
    // phone runs 60, but the edge makes both reliable).
    if (G.firing && w.def.auto) playerShoot(G.time);
    else if (!w.def.auto && (G.fireEdge || (G.firing && !G._shotHeld))) playerShoot(G.time);
    G._shotHeld = G.firing;
    G.fireEdge = false;
    stepChannel(dt);
    // Pick up a dropped charge by walking over it.
    if (rounds.bomb.state === 'dropped') rounds.tryPickup(playerTarget);
    stepGrenade(dt);
  } else if (G.phase === 'live' && !G.alive) {
    stepGrenade(dt);
  }

  // Bots fight in every live round, and keep fighting while the player
  // spectates after death.
  if (G.phase === 'live') {
    bots.step(dt, G.time, botCtx);
    // Attacker bots pick up a dropped charge.
    if (rounds.bomb.state === 'dropped') {
      for (const bot of bots.bots) {
        if (bot.team === 'van' && bot.alive && rounds.tryPickup(bot)) {
          bot.isCarrier = true;
          break;
        }
      }
    }
    // A bot carrier that reaches the site plants when it is clear.
    const carrier = bots.carrier();
    if (carrier && rounds.bomb.state === 'carried' && rounds.bomb.carrier === carrier) {
      carrier.isCarrier = true;
    }
  }

  rounds.step(dt);
  effects.step(dt);

  // Bomb lamp blinks while planted.
  if (rounds.bomb.state === 'planted') {
    bombLamp.material.color.setHex(Math.floor(G.time * 3) % 2 === 0 ? 0xffb347 : 0xc65b4e);
  }
}

// ----- render ---------------------------------------------------------------
function render() {
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch, p.yaw, 0);
  // Walk bob and recoil settle on the viewmodel.
  const speed = player.groundSpeed();
  G.bobPhase += speed * 0.09;
  const bob = Math.min(1, speed / 5) * 0.012;
  viewGun.position.x = 0.24 + Math.sin(G.bobPhase * 2) * bob;
  viewGun.position.y = -0.22 + Math.abs(Math.sin(G.bobPhase)) * bob;
  viewGun.position.z += ((-0.5) - viewGun.position.z) * 0.25;
  renderer.render(scene, camera);
}

// ----- HUD snapshot ----------------------------------------------------------
function hudSnapshot() {
  const w = currentWeapon();
  const moving = player.groundSpeed() > 0.8;
  const inSite = player.state.position.distanceTo(map.site.center) < map.site.radius;
  return {
    health: Math.max(0, Math.ceil(G.health)),
    mag: w.mag,
    reserve: w.reserve,
    weaponName: w.def.name,
    reloading: w.reloading,
    grenades: G.grenades,
    timer: rounds.phase === 'buy' ? rounds.phaseTime : rounds.phase === 'live' ? rounds.phaseTime : 0,
    scoreVan: rounds.scoreVan,
    scoreSen: rounds.scoreSen,
    aliveVan: (G.alive ? 1 : 0) + bots.aliveCount('van'),
    aliveSen: bots.aliveCount('sen'),
    money: G.money,
    round: rounds.round,
    phase: rounds.phase,
    spread: w.spreadDeg(moving, !player.state.onGround, player.state.crouching),
    bombState: rounds.bomb.state,
    carryingBomb: rounds.bomb.carrier === playerTarget,
    bombFuse: rounds.bomb.fuse,
    hint: hintText(),
    progress: channelProgress(),
    owned: G.owned,
    current: G.current,
    touch: IS_TOUCH,
    plantAvailable: G.phase === 'live' && G.alive && rounds.bomb.state === 'carried' && rounds.bomb.carrier === playerTarget && inSite,
  };
}

function hintText() {
  if (G.phase !== 'live' || !G.alive) return '';
  const inSite = player.state.position.distanceTo(map.site.center) < map.site.radius;
  if (rounds.bomb.state === 'carried' && rounds.bomb.carrier === playerTarget && inSite) return IS_TOUCH ? 'Hold PLANT — plant the charge' : 'Hold E — plant the charge';
  if (rounds.bomb.state === 'planted') {
    const d = player.state.position.distanceTo(rounds.bomb.position);
    if (d < 12) return 'Charge planted — fall back!';
  }
  if (rounds.bomb.state === 'dropped') return 'Charge dropped — walk over it to pick it up';
  return '';
}

function channelProgress() {
  if (G.phase !== 'live' || !G.alive) return -1;
  if (rounds.bomb.state === 'carried' && rounds.bomb.carrier === playerTarget) return rounds.bomb.plantProgress;
  return -1;
}

// ----- screenshot modes ------------------------------------------------------
function applyShotMode() {
  if (!SHOT) return;
  if (SHOT === 'start') {
    // Menu over the yard: the player spawns looking north, defenders hold mid.
    player.reset(0, 14, 0);
    camera.position.set(0, 1.6, 14);
    camera.rotation.set(0, 0, 0);
    hud.showMenu();
  } else if (SHOT === 'play') {
    hud.hideAllOverlays();
    G.phase = 'live';
    rounds.phase = 'live';
    rounds.phaseTime = 95;
    // Loadout for the shot: rifle in hand, a grenade, money in the bank.
    G.owned = ['pistol', 'smg', 'rifle'];
    G.weapons.smg = createWeaponState('smg');
    G.weapons.rifle = createWeaponState('rifle');
    G.current = 'rifle';
    G.grenades = 1;
    G.money = 4750;
    player.reset(0, 8, 0.12);
    // Stage two defenders mid-lane so the frame has a fight in it.
    const sen = bots.bots.filter((b) => b.team === 'sen');
    sen[0].position.set(-2.5, 0, -4);
    sen[0].yaw = Math.PI;
    sen[1].position.set(3.5, 0, -6);
    sen[1].yaw = Math.PI;
    sen[2].position.set(0, 0, -11);
    sen[2].yaw = Math.PI;
    for (const b of sen) {
      b.parts.group.position.copy(b.position);
      b.parts.group.rotation.y = b.yaw;
    }
    const van = bots.bots.filter((b) => b.team === 'van');
    van[1].position.set(-4, 0, 4);
    van[1].yaw = 0;
    van[1].parts.group.position.copy(van[1].position);
    van[1].parts.group.rotation.y = 0;
    // A tracer already in the air sells the firefight.
    effects.tracer(_v1.set(0.2, 1.45, 7.5), _v2.set(-2.5, 1.3, -4));
  } else if (SHOT === 'end') {
    hud.hideAllOverlays();
    rounds.scoreVan = 2;
    rounds.scoreSen = 1;
    rounds.round = 3;
    rounds.kills = 7;
    rounds.deaths = 2;
    rounds.plants = 1;
    G.money = 6150;
    hud.showRoundEnd(
      'Round won',
      'The charge detonated at the Pier.',
      '<b>Score</b> Vanguard 2 — 1 Sentinel &nbsp;·&nbsp; <b>Round</b> 3 / 9<br><b>You</b> 7 kills · 2 deaths · 1 plants · $6150',
    );
    player.reset(0, -8, Math.PI);
    camera.position.set(0, 1.6, -8);
    camera.rotation.set(0, Math.PI, 0);
    bombMesh.visible = true;
    bombMesh.position.set(0, 0.15, -13);
  }
  render();
}

// ----- main loop --------------------------------------------------------------
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  if (!G.paused && G.phase !== 'menu') {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= STEP && n < 5) {
      simStep(STEP);
      acc -= STEP;
      n += 1;
    }
    if (n === 5) acc = 0;
  }
  render();
  const snap = hudSnapshot();
  hud.update(snap);
  if (touch) touch.sync(snap);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Debug hook for automated playtests (read-only): position, health, phase,
// score and ammo. The game itself never reads it.
window.__dusk = {
  get pos() { const p = player.state.position; return [p.x, p.y, p.z]; },
  get health() { return G.health; },
  get alive() { return G.alive; },
  get phase() { return rounds.phase; },
  get gphase() { return G.phase; },
  get score() { return [rounds.scoreVan, rounds.scoreSen]; },
  get ammo() { const w = currentWeapon(); return [w.mag, w.reserve]; },
  get money() { return G.money; },
  get botsAlive() { return [bots.aliveCount('van'), bots.aliveCount('sen')]; },
  get timer() { return rounds.phaseTime; },
  get keys() { return [...G.keys]; },
  get firing() { return G.firing; },
  get paused() { return G.paused; },
  get vel() { const v = player.state.velocity; return [v.x, v.y, v.z]; },
  get locked() { return document.pointerLockElement === renderer.domElement; },
  get yaw() { return player.state.yaw; },
  get pitch() { return player.state.pitch; },
  get isTouch() { return IS_TOUCH; },
  get touchUI() { return !!touch && !document.getElementById('touch-ui').hidden; },
  get joy() { return touch ? [touch.state.joyVec.x, touch.state.joyVec.y] : [0, 0]; },
  get plantAvailable() { return hudSnapshot().plantAvailable; },
};

applyShotMode();
if (!SHOT) {
  player.reset(0, 14, 0);
  hud.showMenu();
}
requestAnimationFrame(frame);
