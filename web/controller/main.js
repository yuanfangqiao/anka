import {actions, icon} from './contract.js';
import {GesturePad} from './gestures.js';
import {TurnGuide} from './turn-guide.js';
import {ControllerLink} from './link.js';
import {MotionLook} from './motion.js';
import {HapticFeedback} from './haptics.js';
import {ScreenLock} from './screen-lock.js';
const screenLock = new ScreenLock();

const $ = id => document.getElementById(id), root = $('controller'), pad = $('pad');
for (const [action, label, glyph] of actions) {
  const button = document.createElement('button');
  button.className = 'function' + (action === 'jump' ? ' jump' : '');
  button.dataset.action = action; button.setAttribute('aria-label', label);
  button.innerHTML = icon(glyph) + `<span>${label}</span>`; pad.append(button);
}
const parameters = new URLSearchParams(location.search), diagnostics = parameters.get('debug') === '1';
const join = new URL(location.href); join.searchParams.delete('debug');
const hasCredential = join.searchParams.has('bindKey') && join.searchParams.has('token');
history.replaceState(null, '', location.pathname + (diagnostics ? '?debug=1' : ''));
if (diagnostics) { $('debug').hidden = false; document.body.classList.add('debug-mode'); }
let logLines = [], pulses = 0, introduced = false;
const haptics = new HapticFeedback({onStatus: text => { $('haptic-status').textContent = text; }});
function log(direction, frame) {
  if (!diagnostics || (frame.type === 'input' && frame.seq % 15 !== 0)) return;
  const safe = {...frame}; delete safe.resumeToken;
  logLines.push(`${new Date().toLocaleTimeString()} ${direction} ${JSON.stringify(safe)}`);
  logLines = logLines.slice(-50); $('log').textContent = logLines.join('\n');
}
const link = new ControllerLink({
  status(connected, text, detail = {}) {
    release();
    screenLock.set(connected);
    root.classList.toggle('online', connected);
    const jump = pad.querySelector('[data-action=jump]');
    jump.setAttribute('aria-label', connected ? '跳跃，手柄已连接' : '跳跃，手柄未连接');
    $('notice').textContent = text;
    if (detail.fatal) openSettings();
    if (connected && !introduced && matchMedia('(pointer:coarse)').matches) {
      introduced = true; openSettings();
      $('notice').textContent = isSecureContext ? '已连接。按游戏握姿拿好手机，点击启用体感并允许方向权限。' : '已连接。当前HTTP地址只能触控；体感需要可信HTTPS。';
    }
  }, log,
  message(frame) {
    if (frame.type === 'feedback') {
      root.classList.add('feedback'); clearTimeout(pulses);
      pulses = setTimeout(() => root.classList.remove('feedback'), 100);
      haptics.play(frame);
    }
  },
});
const motion = new MotionLook({onPose: pose => {
  if (link.online && !$('setup').open && !document.hidden) link.pose(pose);
}, aiming: () => link.controls.buttons.aim, onStatus: text => {
  $('notice').textContent = text;
  if (text === '体感已启用' && $('setup').open) $('setup').close();
}});
const turnGuide = new TurnGuide(pad);
const gestures = new GesturePad({
  onTurn(degrees) { link.turnBy(degrees); },
  onMove(value) { link.controls.move = value; },
  onAction(action) { if (action) link.action(action); },
  onDrag(value) {
    const stick = $('stick'); stick.hidden = value?.kind !== 'move'; pad.classList.toggle('dragging', !!value);
    if (value?.kind === 'turn') turnGuide.show(value, gestures.cellWidth); else turnGuide.hide();
    if (value?.kind === 'move') {
      stick.style.left = value.x + 'px'; stick.style.top = value.y + 'px';
      stick.firstElementChild.style.transform = `translate(calc(-50% + ${value.dx * 30}px),calc(-50% + ${value.dy * 30}px))`;
    }
  },
});
function hit(x, y) { return document.elementFromPoint(x, y)?.closest('[data-action]')?.dataset.action; }
pad.addEventListener('pointerdown', event => {
  event.preventDefault(); pad.setPointerCapture(event.pointerId);
  gestures.radius = pad.clientWidth * .23;
  const cells = pad.querySelectorAll('.function');
  gestures.cellWidth = cells[1].getBoundingClientRect().left - cells[0].getBoundingClientRect().left;
  const action = hit(event.clientX, event.clientY);
  gestures.down(event.pointerId, event.clientX, event.clientY, action, performance.now());
  event.target.closest('button')?.classList.add('pending');
});
pad.addEventListener('pointermove', event => gestures.move(event.pointerId, event.clientX, event.clientY));
pad.addEventListener('pointerup', event => {
  gestures.up(event.pointerId, event.clientX, event.clientY, hit(event.clientX, event.clientY), performance.now());
  if (pad.hasPointerCapture(event.pointerId)) pad.releasePointerCapture(event.pointerId);
  pad.querySelectorAll('.pending').forEach(x => x.classList.remove('pending')); link.input();
});
for (const kind of ['pointercancel', 'lostpointercapture']) pad.addEventListener(kind, event => {
  gestures.cancel(event.pointerId); link.input();
});
const held = new Map(), keys = new Set();
for (const button of document.querySelectorAll('[data-held]')) {
  const key = button.dataset.held, pointers = new Set(); held.set(key, {button, pointers});
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); button.setPointerCapture(event.pointerId); pointers.add(event.pointerId);
    button.classList.add('pressed'); link.held(key, true);
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(eventName, event => {
    pointers.delete(event.pointerId); button.classList.toggle('pressed', pointers.size > 0);
    link.held(key, pointers.size > 0);
  });
}
function release() {
  keys.clear(); gestures.reset(); motion.reset();
  for (const {button, pointers} of held.values()) { pointers.clear(); button.classList.remove('pressed'); }
  link.reset();
}
function openSettings() { release(); if (!$('setup').open) $('setup').showModal(); }
$('settings').addEventListener('click', openSettings);
$('setup').addEventListener('close', () => { release(); link.visibility(!document.hidden); });
$('connect').addEventListener('click', () => {
  link.connect($('address').value.trim()); $('address').value = ''; $('setup').close();
});
$('motion').addEventListener('click', async () => {
  try { await motion.start(); }
  catch (error) { $('notice').textContent = error.message; }
});
$('sensitivity').addEventListener('input', event => { motion.sensitivity = Number(event.target.value); });
$('ads-only').addEventListener('change', event => { motion.adsOnly = event.target.checked; motion.resetReference(); });
$('test-haptic').addEventListener('click', () => { haptics.play({durationMs:60}); root.classList.add('feedback'); setTimeout(() => root.classList.remove('feedback'),150); });
let strip = null;
$('touch-look').addEventListener('click', () => {
  if (strip) { strip.remove(); strip = null; return; }
  motion.stop(); strip = document.createElement('div'); strip.className = 'look-strip';
  strip.textContent = '触控观察 · 在此滑动'; root.insertBefore(strip, $('settings'));
  let last = null;
  strip.addEventListener('pointerdown', e => { strip.setPointerCapture(e.pointerId); last = [e.clientX, e.clientY]; });
  strip.addEventListener('pointermove', e => {
    if (last) { link.look((e.clientX - last[0]) * .25, -(e.clientY - last[1]) * .25); last = [e.clientX, e.clientY]; }
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) strip.addEventListener(name, () => { last = null; });
  $('setup').close();
});
document.addEventListener('visibilitychange', () => { release(); link.visibility(!document.hidden); if (document.hidden) motion.suspend(); else motion.resume(); });
window.addEventListener('blur', release);
window.addEventListener('orientationchange', release);
window.addEventListener('resize', () => { gestures.reset(); motion.reset(); });
window.addEventListener('pagehide', () => { release(); link.close(); motion.suspend(); screenLock.set(false); root.classList.remove('online'); });
window.addEventListener('pageshow', event => { if (event.persisted) { link.resume(); motion.resume(); } });
root.addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('keydown', event => {
  if ($('setup').open || /INPUT|TEXTAREA/.test(event.target.tagName)) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
    keys.add(event.code); const x = +keys.has('KeyD') - +keys.has('KeyA'), y = +keys.has('KeyW') - +keys.has('KeyS');
    const length = Math.max(1, Math.hypot(x, y)); link.controls.move = {x: x / length, y: y / length};
  }
  if (event.code === 'Space' && !event.repeat) { event.preventDefault(); link.action('jump'); }
});
window.addEventListener('keyup', event => {
  if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
  keys.delete(event.code); const x = +keys.has('KeyD') - +keys.has('KeyA'), y = +keys.has('KeyW') - +keys.has('KeyS');
  const length = Math.max(1, Math.hypot(x, y)); link.controls.move = {x: x / length, y: y / length}; link.input();
});
$('send-json').addEventListener('click', () => {
  try { const frame = JSON.parse($('json').value); if (['input', 'action'].includes(frame.type)) frame.seq = ++link.seq; link.send(frame); }
  catch { $('log').textContent = 'JSON格式错误'; }
});
$('pause-input').addEventListener('click', event => { link.paused = !link.paused; event.target.textContent = link.paused ? '恢复输入' : '暂停输入'; });
$('drop-link').addEventListener('click', () => link.socket?.close());
if (hasCredential) link.connect(join.href); else openSettings();
