// Touch controls for Dusk Harbor: virtual joystick, drag-to-look and thumb
// buttons, active only on touch devices. Desktop input is untouched: this
// module feeds the same key set (G.keys) and the same fire flag the mouse
// and keyboard handlers use, so movement, shooting, reload, weapon
// switching, grenades and the plant channel behave exactly like their
// keyboard twins. No pointer lock is ever requested on touch.
export const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const JOY_RADIUS = 56;    // px the knob travels from its origin
const JOY_DEAD = 0.22;    // dead zone, fraction of the radius
const LOOK_SENS = 0.0042; // radians of yaw/pitch per px of drag

const JOY_KEYS = ['KeyW', 'KeyS', 'KeyD', 'KeyA'];

export function createTouchControls(hooks) {
  document.body.classList.add('touch');
  const ui = document.getElementById('touch-ui');
  const joyBase = document.getElementById('joy-base');
  const joyKnob = document.getElementById('joy-knob');
  const plantBtn = document.getElementById('t-plant');
  ui.hidden = false;

  const joyVec = { x: 0, y: 0 };
  let joyId = null;
  let joyOrigin = { x: 0, y: 0 };
  let lookId = null;
  let lookLast = { x: 0, y: 0 };

  function setKey(code, on) {
    if (on) hooks.keys.add(code);
    else hooks.keys.delete(code);
  }

  function applyJoy() {
    // Forward is up on the stick (screen -y); strafe is stick x.
    setKey('KeyW', -joyVec.y > JOY_DEAD);
    setKey('KeyS', joyVec.y > JOY_DEAD);
    setKey('KeyD', joyVec.x > JOY_DEAD);
    setKey('KeyA', -joyVec.x > JOY_DEAD);
  }

  function clearJoy() {
    joyVec.x = 0;
    joyVec.y = 0;
    for (const k of JOY_KEYS) hooks.keys.delete(k);
    joyBase.style.display = 'none';
    joyId = null;
  }

  function joyStart(t) {
    joyId = t.identifier;
    joyOrigin = { x: t.clientX, y: t.clientY };
    joyBase.style.display = 'block';
    joyBase.style.left = `${t.clientX - JOY_RADIUS}px`;
    joyBase.style.top = `${t.clientY - JOY_RADIUS}px`;
    joyKnob.style.transform = 'translate(-50%, -50%)';
  }

  function joyMove(t) {
    let dx = t.clientX - joyOrigin.x;
    let dy = t.clientY - joyOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    joyVec.x = dx / JOY_RADIUS;
    joyVec.y = dy / JOY_RADIUS;
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    applyJoy();
  }

  function onTouchStart(e) {
    if (!e.cancelable) return;
    for (const t of e.changedTouches) {
      const el = t.target;
      // Touches on a menu overlay or a thumb button belong to that element.
      if (el && el.closest && el.closest('.overlay, .touch-btn')) continue;
      if (t.clientX < innerWidth / 2 && joyId === null) {
        joyStart(t);
        hooks.unlock();
        e.preventDefault();
      } else if (lookId === null) {
        lookId = t.identifier;
        lookLast = { x: t.clientX, y: t.clientY };
        hooks.unlock();
        e.preventDefault();
      }
    }
  }

  function onTouchMove(e) {
    if (!e.cancelable) return;
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyMove(t);
        e.preventDefault();
      } else if (t.identifier === lookId) {
        hooks.look(t.clientX - lookLast.x, t.clientY - lookLast.y, LOOK_SENS);
        lookLast = { x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    }
  }

  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) clearJoy();
      else if (t.identifier === lookId) lookId = null;
    }
  }

  addEventListener('touchstart', onTouchStart, { passive: false });
  addEventListener('touchmove', onTouchMove, { passive: false });
  addEventListener('touchend', onTouchEnd);
  addEventListener('touchcancel', onTouchEnd);
  // A stray blur (e.g. a notification) must not leave the player walking.
  addEventListener('blur', clearJoy);

  // Buttons: hold-to-fire / hold-to-plant / hold-to-jump, tap for the rest.
  function holdButton(id, down, up) {
    const btn = document.getElementById(id);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); hooks.unlock(); down(); }, { passive: false });
    const release = (e) => { e.preventDefault(); up(); };
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
  }
  function tapButton(id, fn) {
    const btn = document.getElementById(id);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); hooks.unlock(); fn(); }, { passive: false });
  }

  holdButton('t-fire', () => { hooks.setFiring(true); hooks.queueFire(); }, () => hooks.setFiring(false));
  holdButton('t-jump', () => hooks.keys.add('Space'), () => hooks.keys.delete('Space'));
  holdButton('t-plant', () => hooks.keys.add('KeyE'), () => hooks.keys.delete('KeyE'));
  tapButton('t-reload', () => hooks.reload());
  tapButton('t-nade', () => hooks.throwGrenade());
  for (const id of ['pistol', 'smg', 'rifle']) {
    tapButton(`t-w-${id}`, () => hooks.switchWeapon(id));
  }

  function sync(state) {
    // Weapon slots light up for owned guns, mark the one in hand.
    for (const id of ['pistol', 'smg', 'rifle']) {
      const btn = document.getElementById(`t-w-${id}`);
      btn.classList.toggle('owned', state.owned.includes(id));
      btn.classList.toggle('current', state.current === id);
    }
    const nade = document.getElementById('t-nade');
    nade.classList.toggle('empty', state.grenades <= 0);
    nade.textContent = `GREN ${state.grenades}`;
    plantBtn.hidden = !state.plantAvailable;
  }

  return { sync, state: { joyVec } };
}
