// Player movement: acceleration, friction, gravity, crouch and jump, resolved as
// a box against the world's colliders one axis at a time, so a wall never swallows
// the player. The same moveBox helper moves the bots.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

const probe = new THREE.Box3();

// Slide a vertical box through the colliders: try x, then z, then settle y on the
// floor or the top of whatever the box lands on. Returns whether the box is on
// the ground. pos and vel are mutated in place; nothing is allocated here.
export function moveBox(colliders, pos, vel, dt, radius, height) {
  function overlaps(x, y, z, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }
  const nextX = pos.x + vel.x * dt;
  if (!overlaps(nextX, pos.y, pos.z, 0.04)) pos.x = nextX;
  else vel.x = 0;
  const nextZ = pos.z + vel.z * dt;
  if (!overlaps(pos.x, pos.y, nextZ, 0.04)) pos.z = nextZ;
  else vel.z = 0;
  pos.y += vel.y * dt;
  let onGround = false;
  const hit = overlaps(pos.x, pos.y, pos.z, 0);
  if (hit && vel.y <= 0) {
    pos.y = hit.max.y;
    vel.y = 0;
    onGround = true;
  } else if (hit) {
    pos.y = hit.min.y - height;
    vel.y = 0;
  }
  if (pos.y < 0) {
    pos.y = 0;
    vel.y = 0;
    onGround = true;
  }
  return onGround;
}

export function createPlayer(colliders) {
  const player = {
    position: new THREE.Vector3(0, 0, 14),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching !== player.crouching) {
      if (crouching) {
        player.crouching = true;
        player.height = CROUCH_HEIGHT;
      } else {
        // Only stand up when the taller box fits.
        probe.min.set(player.position.x - RADIUS, player.position.y + 0.02, player.position.z - RADIUS);
        probe.max.set(player.position.x + RADIUS, player.position.y + STAND_HEIGHT - 0.02, player.position.z + RADIUS);
        let blocked = false;
        for (const collider of colliders) if (probe.intersectsBox(collider)) { blocked = true; break; }
        if (!blocked) {
          player.crouching = false;
          player.height = STAND_HEIGHT;
        }
      }
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;
    player.onGround = moveBox(colliders, player.position, player.velocity, dt, RADIUS, player.height);
    player.velocity.y = Math.max(-30, player.velocity.y);
  }

  return {
    state: player,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
    reset(x, z, yaw) {
      player.position.set(x, 0, z);
      player.velocity.set(0, 0, 0);
      player.yaw = yaw;
      player.pitch = 0;
      player.eye = STAND_EYE;
      player.height = STAND_HEIGHT;
      player.crouching = false;
      player.onGround = true;
    },
  };
}
