/**
 * A small, deterministic kick interaction for the authored football actors.
 * No scene imports, timers, physics engine or global listeners are needed.
 * The owner drives update(dt) and resets on leaving the Energy Corner.
 */
const DURATION = 2;
const REDUCED_DURATION = .55;
const FLIGHT_END = .55;
const ROLL_END = .80;
const RETURN_START = 1.10;
const FALLBACK_TARGET = Object.freeze({ x: 14.08, y: .15, z: -28.5 });
const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const xyz = value => ({ x: value.x, y: value.y, z: value.z });
function writeXYZ(value, next) {
  if (typeof value?.set === 'function') value.set(next.x, next.y, next.z);
  else if (value) Object.assign(value, next);
}
function writeQuaternion(value, next) {
  if (!value || !next) return;
  if (typeof value.set === 'function') value.set(next.x, next.y, next.z, next.w);
  else Object.assign(value, next);
}
function capture(object) {
  if (!object) return null;
  return {
    position: xyz(object.position),
    scale: xyz(object.scale),
    rotation: { ...xyz(object.rotation), order: object.rotation.order },
    quaternion: object.quaternion ? { ...xyz(object.quaternion), w: object.quaternion.w } : null,
  };
}
function restore(object, saved) {
  if (!object || !saved) return;
  writeXYZ(object.position, saved.position);
  writeXYZ(object.scale, saved.scale);
  if (object.rotation?.set)
    object.rotation.set(saved.rotation.x, saved.rotation.y, saved.rotation.z, saved.rotation.order);
  else if (object.rotation) Object.assign(object.rotation, saved.rotation);
  writeQuaternion(object.quaternion, saved.quaternion);
}
function targetFrom(model, ball) {
  const value = ball?.userData?.footballTarget ?? model?.userData?.football?.target;
  const candidate = Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : value;
  return candidate && ['x', 'y', 'z'].every(axis => Number.isFinite(candidate[axis]))
    ? xyz(candidate) : { ...FALLBACK_TARGET };
}

/** onState receives {state, busy, available}; construction emits no callback. */
export function createFootballInteraction(model, {
  reducedMotion = { matches: false },
  onState = () => {},
} = {}) {
  let ball = null, net = null;
  model?.traverse?.(object => {
    if (!ball && object.userData?.interactionRole === 'football') ball = object;
    if (!net && object.userData?.interactionRole === 'goal-net') net = object;
  });
  const ballRest = capture(ball), netRest = capture(net);
  const target = targetFrom(model, ball);
  const radius = Number.isFinite(ball?.userData?.footballRadius) && ball.userData.footballRadius > 0
    ? ball.userData.footballRadius : .15;
  const home = ballRest?.position;
  const dx = home ? target.x - home.x : 0, dz = home ? target.z - home.z : 0;
  const distance = Math.hypot(dx, dz);
  let disposed = false, busy = false, elapsed = 0, reducedCycle = false, duration = DURATION;
  let state = ball && net ? 'ready' : 'unavailable';
  const available = () => !disposed && Boolean(ball && net);
  function transition(next) {
    if (state === next) return;
    state = next;
    onState({ state, busy, available: available() });
  }
  function spin(progress) {
    const angle = distance * progress / radius;
    if (ballRest.quaternion && ball.quaternion && distance > 0) {
      const half = angle / 2, sine = Math.sin(half);
      const ax = -dz / distance * sine, az = dx / distance * sine, aw = Math.cos(half);
      const b = ballRest.quaternion;
      // Axis-angle delta * original orientation; never accumulates frame drift.
      writeQuaternion(ball.quaternion, {
        x: aw * b.x + ax * b.w - az * b.y,
        y: aw * b.y + az * b.x - ax * b.z,
        z: aw * b.z + az * b.w + ax * b.y,
        w: aw * b.w - ax * b.x - az * b.z,
      });
    } else if (ball.rotation) {
      writeXYZ(ball.rotation, {
        x: ballRest.rotation.x + (distance ? -dz / distance * angle : 0),
        y: ballRest.rotation.y,
        z: ballRest.rotation.z + (distance ? dx / distance * angle : 0),
      });
    }
  }
  function place(progress, lift = 0) {
    writeXYZ(ball.position, {
      x: home.x + dx * progress,
      y: home.y + (target.y - home.y) * progress + lift,
      z: home.z + dz * progress,
    });
    spin(progress);
  }
  function goalWithoutMotion() {
    restore(ball, ballRest);
    writeXYZ(ball.position, target);
    restore(net, netRest);
  }
  function reset() {
    if (disposed) return;
    restore(ball, ballRest);
    restore(net, netRest);
    busy = false;
    elapsed = 0;
    transition(available() ? 'ready' : 'unavailable');
  }
  return {
    get available() { return available(); },
    get busy() { return busy; },
    kick() {
      if (!available() || busy) return false;
      restore(ball, ballRest);
      restore(net, netRest);
      busy = true;
      elapsed = 0;
      reducedCycle = Boolean(reducedMotion.matches);
      duration = reducedCycle ? REDUCED_DURATION : DURATION;
      if (reducedCycle) {
        goalWithoutMotion();
        transition('goal');
      } else transition('flight');
      return true;
    },
    update(dt) {
      if (disposed || !busy) return;
      const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
      if (reducedMotion.matches && !reducedCycle) {
        // A live accessibility preference change cuts the running animation.
        reducedCycle = true;
        elapsed = 0;
        duration = .45;
        goalWithoutMotion();
        transition('goal');
        return;
      }
      elapsed = Math.min(duration, elapsed + delta);
      if (elapsed >= duration - 1e-9) {
        reset();
        return;
      }
      if (reducedCycle) {
        goalWithoutMotion();
        return;
      }
      let progress;
      if (elapsed < FLIGHT_END) {
        const t = elapsed / FLIGHT_END;
        progress = .82 * smooth(t);
        place(progress, .32 * Math.sin(Math.PI * t));
        transition('flight');
      } else if (elapsed < ROLL_END) {
        progress = .82 + .18 * smooth((elapsed - FLIGHT_END) / (ROLL_END - FLIGHT_END));
        place(progress);
        transition('rolling');
      } else if (elapsed < RETURN_START) {
        place(1);
        transition('goal');
      } else {
        progress = 1 - smooth((elapsed - RETURN_START) / (DURATION - RETURN_START));
        place(progress);
        transition('returning');
      }
      restore(net, netRest);
      const impact = (elapsed - .72) / .42;
      if (impact > 0 && impact < 1) {
        const pulse = Math.sin(Math.PI * impact) ** 2;
        net.position.x = netRest.position.x + .045 * pulse;
        net.scale.x = netRest.scale.x * (1 + .04 * pulse);
        net.scale.z = netRest.scale.z * (1 - .02 * pulse);
      }
    },
    reset,
    isBall(object) {
      if (!available()) return false;
      while (object) {
        if (object === ball) return true;
        object = object.parent;
      }
      return false;
    },
    dispose() {
      if (disposed) return;
      restore(ball, ballRest);
      restore(net, netRest);
      busy = false;
      disposed = true;
      transition('disposed');
    },
  };
}

