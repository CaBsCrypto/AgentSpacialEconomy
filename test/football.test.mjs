import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootballInteraction } from '../dist/football.mjs';

function vector(x, y, z) {
  return { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } };
}
function actor(role, position) {
  return {
    userData: { interactionRole: role },
    position: vector(...position),
    rotation: { ...vector(.12, -.34, .23), order: 'YXZ',
      set(x, y, z, order) { this.x = x; this.y = y; this.z = z; this.order = order; } },
    quaternion: { x: .1, y: .2, z: .3, w: Math.sqrt(.86),
      set(x, y, z, w) { Object.assign(this, { x, y, z, w }); } },
    scale: vector(1.1, .9, 1.2),
    parent: null,
  };
}
function pose(object) {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z, object.rotation.order],
    quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}
function fixture({ missingBall = false, missingNet = false, reduced = false } = {}) {
  const ball = actor('football', [12.65, .15, -28.1]);
  ball.userData.footballTarget = [14.08, .15, -28.5];
  ball.userData.footballRadius = .15;
  const net = actor('goal-net', [14.35, .45, -28.5]);
  const frame = actor('goal-frame', [13.78, 0, -28.5]);
  const model = { userData: {}, traverse(callback) {
    callback(this); callback(frame);
    if (!missingBall) callback(ball);
    if (!missingNet) callback(net);
  } };
  ball.parent = net.parent = frame.parent = model;
  const child = { parent: ball };
  const motion = { matches: reduced }, states = [];
  const controller = createFootballInteraction(model, {
    reducedMotion: motion,
    onState: state => states.push(state),
  });
  return { ball, net, frame, child, model, motion, states, controller,
    ballHome: pose(ball), netHome: pose(net) };
}

test('kick flies, rolls, flexes only the net, and automatically restores exact actor transforms', () => {
  const f = fixture(), { controller: c } = f;
  assert.equal(c.available, true); assert.equal(c.busy, false);
  assert.deepEqual(f.states, []);
  const frameHome = pose(f.frame);
  assert.equal(c.kick(), true);
  assert.equal(c.busy, true);
  c.update(.30);
  assert(f.ball.position.x > 12.65 && f.ball.position.x < 14.08);
  assert(f.ball.position.y > .15, 'airborne arc is visible');
  assert.notDeepEqual(pose(f.ball).quaternion, f.ballHome.quaternion);
  const inFlight = pose(f.ball);
  assert.equal(c.kick(), false, 'repeated input cannot restart an active kick');
  assert.deepEqual(pose(f.ball), inFlight);
  c.update(.30);
  assert.equal(f.states.at(-1).state, 'rolling');
  assert.equal(f.ball.position.y, .15, 'the final approach rolls on the floor');
  c.update(.33);
  assert.equal(f.states.at(-1).state, 'goal');
  assert.deepEqual(pose(f.ball).position, [14.08, .15, -28.5]);
  assert(f.net.position.x > f.netHome.position[0] + .02);
  assert(f.net.scale.x > f.netHome.scale[0]);
  assert(f.net.scale.z < f.netHome.scale[2]);
  assert.deepEqual(pose(f.frame), frameHome, 'the fixed posts never deform');
  c.update(.40);
  assert.equal(f.states.at(-1).state, 'returning');
  assert(f.ball.position.x < 14.08 && f.ball.position.x > 12.65);
  c.update(.67);
  assert.equal(c.busy, false); assert.equal(c.available, true);
  assert.deepEqual(pose(f.ball), f.ballHome);
  assert.deepEqual(pose(f.net), f.netHome);
  assert.deepEqual(f.states.map(s => s.state), ['flight', 'rolling', 'goal', 'returning', 'ready']);
  assert.equal(f.states.at(-1).busy, false);
});

test('reset is immediate, idempotent and allows another kick without accumulated drift', () => {
  const f = fixture(), c = f.controller;
  c.kick(); c.update(.93); c.reset();
  assert.deepEqual(pose(f.ball), f.ballHome);
  assert.deepEqual(pose(f.net), f.netHome);
  const count = f.states.length;
  c.reset(); assert.equal(f.states.length, count);
  for (let i = 0; i < 5; i++) {
    assert.equal(c.kick(), true);
    for (let frame = 0; frame < 120; frame++) c.update(1 / 60);
    assert.equal(c.busy, false);
    assert.deepEqual(pose(f.ball), f.ballHome);
    assert.deepEqual(pose(f.net), f.netHome);
  }
});

test('reduced motion uses a brief static goal state with no flight, spin or net vibration', () => {
  const f = fixture({ reduced: true }), c = f.controller;
  assert.equal(c.kick(), true);
  assert.deepEqual(pose(f.ball).position, [14.08, .15, -28.5]);
  assert.deepEqual(pose(f.ball).quaternion, f.ballHome.quaternion);
  assert.deepEqual(pose(f.net), f.netHome);
  c.update(.54);
  assert.equal(c.busy, true);
  assert.deepEqual(pose(f.net), f.netHome);
  c.update(.01);
  assert.equal(c.busy, false);
  assert.deepEqual(pose(f.ball), f.ballHome);
  assert.deepEqual(f.states.map(s => s.state), ['goal', 'ready']);
});

test('a live reduced-motion change stops the running motion and never resumes its old trajectory', () => {
  const f = fixture(), c = f.controller;
  c.kick(); c.update(.30);
  f.motion.matches = true; c.update(0);
  assert.deepEqual(pose(f.ball).position, [14.08, .15, -28.5]);
  assert.deepEqual(pose(f.ball).quaternion, f.ballHome.quaternion);
  assert.deepEqual(pose(f.net), f.netHome);
  f.motion.matches = false; c.update(.20);
  assert.deepEqual(pose(f.ball).position, [14.08, .15, -28.5]);
  assert.deepEqual(pose(f.net), f.netHome);
  c.update(.25);
  assert.equal(c.busy, false);
  assert.deepEqual(pose(f.ball), f.ballHome);
});

test('invalid frame deltas are harmless and a delayed frame finishes the cycle safely', () => {
  const f = fixture(), c = f.controller;
  c.kick();
  const start = pose(f.ball);
  for (const delta of [NaN, Infinity, -Infinity, -1, undefined, 0]) c.update(delta);
  assert.deepEqual(pose(f.ball), start);
  assert.equal(c.busy, true);
  c.update(1000);
  assert.equal(c.busy, false);
  assert.deepEqual(pose(f.ball), f.ballHome);
  assert.deepEqual(pose(f.net), f.netHome);
});

test('actor lookup requires both roles and ray hits resolve only to the football hierarchy', () => {
  const f = fixture(), c = f.controller;
  assert.equal(c.isBall(f.ball), true); assert.equal(c.isBall(f.child), true);
  assert.equal(c.isBall(f.net), false); assert.equal(c.isBall(f.frame), false);
  assert.equal(c.isBall(null), false);
  for (const option of [{ missingBall: true }, { missingNet: true }]) {
    const absent = fixture(option);
    assert.equal(absent.controller.available, false);
    assert.equal(absent.controller.kick(), false);
    absent.controller.update(1); absent.controller.reset(); absent.controller.dispose();
    assert.equal(absent.controller.busy, false);
  }
  const absent = createFootballInteraction(null);
  assert.equal(absent.available, false); assert.equal(absent.kick(), false);
  absent.update(1); absent.reset(); absent.dispose();
});

test('dispose restores actors once and disables all subsequent interaction', () => {
  const f = fixture(), c = f.controller;
  c.kick(); c.update(.93); c.dispose();
  assert.deepEqual(pose(f.ball), f.ballHome);
  assert.deepEqual(pose(f.net), f.netHome);
  assert.equal(c.available, false); assert.equal(c.busy, false);
  assert.equal(c.isBall(f.ball), false); assert.equal(c.kick(), false);
  const count = f.states.length;
  c.update(1000); c.reset(); c.dispose();
  assert.equal(f.states.length, count);
  assert.deepEqual(pose(f.ball), f.ballHome);
  assert.deepEqual(pose(f.net), f.netHome);
  assert.deepEqual(f.states.at(-1), { state: 'disposed', busy: false, available: false });
});

