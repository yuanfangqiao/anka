import {freshControls} from './contract.js';

/** No player cookies or auth tokens are read. Secrets stay in this page's memory. */
export class ControllerLink {
  constructor({status, message = () => {}, log = () => {}}) {
    Object.assign(this, {status, message, log, controls: freshControls(), socket: null,
      session: null, seq: 0, online: false, paused: false, visible: true, retries: 0});
    this.lastHeard = performance.now();
    this.turn = this.turnTotal = 0; this.turnDirty = false; this.currentPose = null; this.poseDirty = false; this.lastSent = 0; this.epoch = 0; this.stopped = false;
    this.startTimers();
  }
  startTimers() {
    clearInterval(this.sendTimer); clearInterval(this.pingTimer);
    this.sendTimer = setInterval(() => this.tick(), 1000 / 60);
    this.pingTimer = setInterval(() => {
      if (this.online && performance.now() - this.lastHeard > 12000) {
        this.online = false; this.status(false, '网络无响应，正在重连'); this.socket?.close();
      }
      this.send({type: 'ping', id: Date.now(), t: performance.now()});
    }, 3000);
  }
  connect(value, resume = false) {
    let url;
    try {
      url = new URL(value, location.origin);
      if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) throw Error();
      if (!['/v1/device/join', '/v1/device/reconnect'].includes(url.pathname)) throw Error();
      if (url.username || url.password || url.hash) throw Error('连接地址不能包含用户密码或片段');
      if (url.host !== location.host) throw Error('请在游戏二维码对应的站点打开手柄');
      url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
      if (location.protocol === 'https:' && url.protocol !== 'wss:') throw Error('HTTPS手柄页面需要安全的WSS链接');
    } catch (e) { this.status(this.online, e.message || '请粘贴完整的手柄二维码链接'); return; }
    this.stopped = false;
    if (!resume) { this.session = null; this.retries = 0; this.turn = this.turnTotal = 0; }
    const epoch = ++this.epoch;
    clearTimeout(this.retry); this.socket?.close(); this.reset(false);
    this.online = false; this.status(false, '正在连接…');
    let ws;
    try { ws = new WebSocket(url); }
    catch { this.stopped = true; this.status(false, '浏览器无法打开此手柄连接，请检查地址'); return; }
    this.socket = ws;
    ws.onmessage = event => {
      if (this.epoch !== epoch) return;
      let frame; try { frame = JSON.parse(event.data); } catch { return; }
      this.lastHeard = performance.now();
      this.log('←', frame);
      if (frame.type === 'bound') {
        this.session = {deviceId: frame.deviceId, token: frame.resumeToken};
        this.online = true; this.retries = 0; this.seq = 0; this.reset();
        this.status(true, '已连接');
      }
      if (frame.type === 'rearm') this.reset();
      if (frame.type === 'closed' || frame.type === 'error') {
        const fatal = !this.session || ['binding_revoked','invalid_token','wrong_principal'].includes(frame.code);
        if (fatal) this.session = null;
        this.stopped = fatal; this.online = false;
        this.status(false, frame.message || '连接中断，正在重试', {fatal}); ws.close();
      }
      this.message(frame);
    };
    ws.onclose = () => {
      if (this.epoch !== epoch) return;
      this.online = false; this.reset(false);
      if (!this.stopped) this.status(false, this.session ? '连接中断，正在持续重连' : '配对未完成，请重新生成二维码', {fatal: !this.session});
      if (this.session && !this.stopped) {
        this.retry = setTimeout(() => {
          const next = new URL('/v1/device/reconnect', location.origin);
          next.search = new URLSearchParams(this.session).toString();
          this.connect(next.href, true);
        }, Math.min(5000, 400 * 2 ** Math.min(4, this.retries++)));
      }
    };
    ws.onerror = () => { if (this.epoch === epoch) this.status(false, '无法连接，请检查链接是否过期'); };
  }
  send(frame) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > 8192) { this.socket.close(); return false; }
    this.socket.send(JSON.stringify(frame)); this.log('→', frame); return true;
  }
  input() {
    if (!this.online || this.paused) return;
    const c = this.controls;
    const frame = {type: 'input', seq: ++this.seq, move: {...c.move},
      look: {...c.look}, buttons: {...c.buttons}, turn: this.turn, turnTotal: this.turnTotal};
    if (this.currentPose) frame.pose = this.currentPose;
    if (this.send(frame)) { c.look = {yaw: 0, pitch: 0}; this.poseDirty = false; this.turnDirty = false; this.lastSent = performance.now(); }
  }
  tick() {
    if (!this.visible) return;
    const c = this.controls, active = this.poseDirty || this.turnDirty || Object.values(c.buttons).some(Boolean) ||
      Object.values(c.move).some(Boolean) || Object.values(c.look).some(Boolean);
    if (active || performance.now() - this.lastSent >= 45) this.input();
  }
  action(action) {
    if (this.online && !this.paused) this.send({type: 'action', seq: ++this.seq, action});
  }
  held(key, value) { this.controls.buttons[key] = value; this.input(); }
  look(yaw, pitch) {
    this.controls.look.yaw = Math.max(-45, Math.min(45, this.controls.look.yaw + yaw));
    this.controls.look.pitch = Math.max(-45, Math.min(45, this.controls.look.pitch + pitch));
  }
  turnBy(degrees) {
    if (!Number.isFinite(degrees) || degrees === 0) return;
    this.turnTotal = (this.turnTotal ?? this.turn ?? 0) + degrees;
    this.turn = ((this.turnTotal + 180) % 360 + 360) % 360 - 180; this.turnDirty = true;
  }
  pose(value) { this.currentPose = {id: value.id, q: [...value.q], gain: value.gain}; this.poseDirty = true; }
  reset(send = true) { this.controls = freshControls(); if (send) this.input(); }
  visibility(visible) { this.reset(); this.visible = visible; }
  resume() {
    this.visible = !document.hidden; this.startTimers();
    if (!this.session) { this.status(false, '请重新扫描游戏二维码'); return; }
    const next = new URL('/v1/device/reconnect', location.origin);
    next.search = new URLSearchParams(this.session).toString(); this.connect(next.href, true);
  }
  close() {
    this.stopped = true; this.reset(); this.epoch++;
    clearInterval(this.sendTimer); clearInterval(this.pingTimer); clearTimeout(this.retry);
    this.socket?.close(); this.online = false;
  }
}
