/* Anka browser SDK v1. No dependencies; include before application code. */
(() => {
  if (window.anka) return;
  let port, identity, state, theme, route = { path: '/', canGoBack: false }, serial = 0;
  const pending = new Map(), listeners = new Map(), commands = new Map();
  const nonce = crypto.randomUUID();
  let resolveReady, rejectReady, guard;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const emit = (name, value) => {
    for (const callback of [...(listeners.get(name) || [])]) {
      try { callback(value); } catch (error) { console.error('[anka-sdk]', error); }
    }
  };
  const on = (name, callback) => {
    const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set);
    return () => { set.delete(callback); if (!set.size) listeners.delete(name); };
  };
  async function request(method, params) {
    await ready;
    return new Promise((resolve, reject) => {
      const id = String(++serial);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Anka 响应超时')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      port.postMessage({ type: 'request', id, method, params });
    });
  }
  const connect = event => {
    const data = event.data;
    if (event.source !== parent || event.origin !== location.origin || data?.source !== 'anka-host'
      || data.version !== 1 || data.type !== 'connected' || data.nonce !== nonce || !event.ports[0]) return;
    port?.close(); port = event.ports[0]; identity = data.appId; state = data.state; theme = data.theme; route = data.route;
    port.onmessage = async ({ data: message }) => {
      if (message.type === 'response') {
        const item = pending.get(message.id);
        if (!item) return;
        clearTimeout(item.timer); pending.delete(message.id);
        message.error ? item.reject(new Error(message.error)) : item.resolve(message.result);
      } else if (message.type === 'event') {
        if (message.name === 'state') state = message.data;
        if (message.name === 'theme') { theme = message.data; document.documentElement.dataset.theme = theme; }
        if (message.name === 'route') route = message.data;
        emit(message.name, message.data);
      } else if (message.type === 'request') {
        try {
          const result = message.method === 'beforeClose' ? (guard ? await guard() : true)
            : await commands.get(message.params.name)?.(message.params.args);
          port.postMessage({ type: 'response', id: message.id, result });
        } catch (error) { port.postMessage({ type: 'response', id: message.id, error: String(error) }); }
      }
    };
    port.start(); document.documentElement.dataset.theme = theme;
    resolveReady(window.anka); emit('state', state); emit('route', route);
  };
  window.addEventListener('message', connect);
  window.anka = Object.freeze({
    version: 1, ready, get appId() { return identity; },
    lifecycle: { get state() { return state; }, on,
      async beforeClose(callback) { guard = callback; await request('beforeClose'); } },
    theme: { get current() { return theme; }, on: callback => on('theme', callback) },
    navigation: {
      get current() { return route; }, on: callback => on('route', callback),
      push: path => request('navigation.push', { path }),
      replace: path => request('navigation.replace', { path }),
      back: () => request('navigation.back'),
      switchApp: appId => request('apps.open', { appId }),
    },
    events: {
      async on(name, callback) {
        const stop = on('bus:' + name, callback); await request('events.subscribe', { name });
        return () => { stop(); if (!listeners.has('bus:' + name)) void request('events.unsubscribe', { name }); };
      },
      emit: (name, data) => request('events.emit', { name, data }),
    },
    storage: {
      get: key => request('storage.get', { key }),
      set: (key, value) => request('storage.set', { key, value }),
      remove: key => request('storage.remove', { key }),
    },
    commands: {
      async register(name, callback) { commands.set(name, callback); await request('commands.register', { name }); },
      execute: (name, args) => request('commands.execute', { name, args }),
    },
  });
  const handshake = () => parent.postMessage({ source: 'anka-sdk', version: 1, type: 'connect', nonce }, location.origin);
  document.addEventListener('pointerdown', () => { if (port) void request('focus').catch(() => {}); }, { capture: true });
  // Wait for load: the host revokes the previous document's channel on every iframe load.
  if (document.readyState === 'complete') handshake();
  else window.addEventListener('load', handshake, { once: true });
  setTimeout(() => { if (!port) rejectReady(new Error('当前页面未连接 Anka 宿主')); }, 15000);
})();
