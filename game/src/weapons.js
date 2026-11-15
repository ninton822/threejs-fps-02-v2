// Weapons: three guns and a frag grenade. Every shot is a hitscan ray with
// distance falloff; spread grows while moving, airborne, or firing fast, and
// recoil kicks the aim up, so stopping to aim pays. Bots use the same code
// through fireShot with their own accuracy, so the ballistics are one system.
import * as THREE from 'three';

// damage, headshot multiplier, rounds per minute, magazine, reserve, spread
// (degrees, standing still), spread while moving, recoil pitch (degrees),
// price, automatic, reload seconds, tracer colour.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', kind: 'pistol', damage: 34, headMult: 2.5,
    rpm: 360, mag: 12, reserve: 48, spread: 0.5, moveSpread: 2.0, recoil: 0.32,
    price: 0, auto: false, reloadTime: 1.4, range: 40, falloff: 18,
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', kind: 'smg', damage: 22, headMult: 2.2,
    rpm: 760, mag: 28, reserve: 112, spread: 1.0, moveSpread: 2.8, recoil: 0.26,
    price: 1500, auto: true, reloadTime: 2.0, range: 34, falloff: 14,
  },
  rifle: {
    id: 'rifle', name: 'Falcon AR', kind: 'rifle', damage: 33, headMult: 3.0,
    rpm: 600, mag: 25, reserve: 75, spread: 0.45, moveSpread: 2.4, recoil: 0.58,
    price: 2700, auto: true, reloadTime: 2.3, range: 55, falloff: 22,
  },
};

export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 1;
export const GRENADE_FUSE = 1.6;
export const GRENADE_RADIUS = 6.5;
export const GRENADE_DAMAGE = 120;

const _ray = new THREE.Ray();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hitBox = new THREE.Box3();
const _tmp = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _upRef = new THREE.Vector3();

// One ray against the map: the nearest box the ray hits, or null. Reuses the
// module ray, so no allocation per shot.
export function rayHitMap(colliders, origin, dir, maxDist) {
  _ray.origin.copy(origin);
  _ray.direction.copy(dir);
  let best = Infinity;
  for (const box of colliders) {
    const t = _ray.intersectBox(box, _tmp);
    if (t !== null && t >= 0 && t < best) best = t;
  }
  return best <= maxDist ? best : null;
}

// Line of sight between two points: true when no map box blocks the segment.
export function hasLineOfSight(colliders, a, b) {
  _dir.subVectors(b, a);
  const dist = _dir.length();
  if (dist < 0.01) return true;
  _dir.multiplyScalar(1 / dist);
  return rayHitMap(colliders, a, _dir, dist) === null;
}

// A shot from `origin` along `forward` with `spreadDeg` of cone error.
// Returns { hit: 'head'|'body'|'map'|null, target, point, dist, damage }.
// Targets are objects with { alive, team, position, headBox(), bodyBox() }.
export function fireShot(colliders, targets, origin, forward, weapon, spreadDeg, rng) {
  _dir.copy(forward);
  // Cone error: an orthonormal basis around the forward vector, then two
  // small perpendicular kicks, uniform in the cone. Module temps only.
  const r = (rng() + rng()) * 0.5 * spreadDeg * (Math.PI / 180);
  const a = rng() * Math.PI * 2;
  _upRef.set(0, 1, 0);
  if (Math.abs(forward.y) > 0.9) _upRef.set(1, 0, 0);
  _right.crossVectors(forward, _upRef).normalize();
  _up.crossVectors(_right, forward).normalize();
  _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();

  const mapDist = rayHitMap(colliders, origin, _dir, weapon.range);
  const maxDist = mapDist === null ? weapon.range : mapDist;
  let bestTarget = null;
  let bestPart = null;
  let bestDist = maxDist;
  for (const target of targets) {
    if (!target.alive) continue;
    for (const part of ['head', 'body']) {
      const box = part === 'head' ? target.headBox(_hitBox) : target.bodyBox(_hitBox);
      _ray.origin.copy(origin);
      _ray.direction.copy(_dir);
      const t = _ray.intersectBox(box, _to);
      if (t !== null && t >= 0 && t < bestDist) {
        bestDist = t;
        bestTarget = target;
        bestPart = part;
      }
    }
  }
  const end = _to.copy(origin).addScaledVector(_dir, bestDist);
  if (!bestTarget) {
    return { hit: mapDist === null ? null : 'map', target: null, point: end, dist: bestDist, damage: 0 };
  }
  let damage = weapon.damage;
  if (bestDist > weapon.falloff) damage *= Math.max(0.45, 1 - (bestDist - weapon.falloff) / weapon.range);
  if (bestPart === 'head') damage *= weapon.headMult;
  return { hit: bestPart, target: bestTarget, point: end, dist: bestDist, damage: Math.round(damage) };
}

// A weapon held by one fighter: ammo, bloom, reload and fire timing.
export function createWeaponState(weaponId) {
  const def = WEAPONS[weaponId];
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    bloom: 0,
    reloading: false,
    reloadEnd: 0,
    lastShot: -10,
    canFire(now) {
      return !this.reloading && this.mag > 0 && (now - this.lastShot) * 1000 >= 60000 / this.def.rpm;
    },
    startReload(now) {
      if (this.reloading || this.reserve <= 0 || this.mag >= this.def.mag) return false;
      this.reloading = true;
      this.reloadEnd = now + this.def.reloadTime;
      return true;
    },
    finishReload() {
      const need = this.def.mag - this.mag;
      const take = Math.min(need, this.reserve);
      this.mag += take;
      this.reserve -= take;
      this.reloading = false;
    },
    spreadDeg(moving, airborne, crouching) {
      let s = this.def.spread + this.bloom;
      if (moving) s += this.def.moveSpread;
      if (airborne) s += 2.2;
      if (crouching) s *= 0.7;
      return s;
    },
    topUpReserve() {
      this.reserve = this.def.reserve;
    },
  };
}

// A thrown frag: gravity arc, one bounce, fuse, then area damage.
export function createGrenade(origin, dir, thrower) {
  return {
    position: origin.clone(),
    velocity: dir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: GRENADE_FUSE,
    thrower,
    alive: true,
    mesh: null,
  };
}
