"""Room authority. Games register their definition through a reversible effect."""
import copy
import logging
import secrets
import threading
import time
from pathlib import Path

from .store import CapabilityStore, digest

COOKIE = 'anka_guest_session'
INVITE_TTL = 600
PLAYER_TTL = 24 * 3600
log = logging.getLogger('anka.rooms')


class RoomError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def fail(code, message, status=400):
    raise RoomError(code, message, status)


class RoomService:
    def __init__(self, path, clock=time.time):
        self.store = CapabilityStore(path)
        self.clock = clock
        self.lock = threading.RLock()
        self.definitions, self.rooms = {}, {}
        self.updating = set()
        self.attempts, self.stopped = {}, False
        self.notify = lambda room: None

    def register(self, app, definition):
        with self.lock:
            self.definitions[app] = definition
        def dispose():
            with self.lock:
                self.definitions.pop(app, None)
                for room in self.rooms.values():
                    if room['app'] == app:
                        self._close(room, '游戏插件已停用')
        return dispose

    def definition(self, app):
        if self.stopped:
            fail('service_unavailable', '房间服务已停止', 503)
        if app in self.updating:
            fail('plugin_updating', '游戏正在更新，请稍后进入', 409)
        factory = self.definitions.get(app)
        if not factory:
            fail('plugin_unavailable', '游戏插件尚未安装或已停用', 404)
        return factory()

    def room(self, app, rid):
        self.definition(app)
        room = self.rooms.get(rid)
        if not room or room['app'] != app:
            fail('room_not_found', '找不到房间，服务器可能已重启', 404)
        if room['expires'] <= self.clock() and room['phase'] != 'closed':
            self._close(room, '房间已到期')
        if room['phase'] == 'closed':
            fail('room_closed', room['notice'] or '房间已关闭', 410)
        return room

    def actor(self, room, username=None, token=None):
        visitor = self.store.visitor(token, self.clock())
        if visitor and visitor['room'] == room['id']:
            pid = visitor['player']
            if pid in room['players']:
                return pid, visitor['expires']
        if username and username == room['owner']:
            return room['host'], room['expires']
        fail('room_forbidden', '你没有这个房间的访问权限，请使用邀请链接加入', 403)

    def view(self, room, pid):
        result = {key: copy.deepcopy(value) for key, value in room.items()
                  if key not in ('owner', 'disconnected', 'resume_phase')}
        result['self'] = pid
        result['server_time'] = self.clock()
        return result

    def create(self, app, username, name, character, map_id):
        with self.lock:
            spec = self.definition(app)
            if not spec.get('build'):
                fail('build_required', '游戏尚未构建，请在插件管理中构建并安装', 409)
            active = [r for r in self.rooms.values() if r['owner'] == username
                      and r['app'] == app and r['phase'] != 'closed']
            for old in active:
                if old['phase'] in ('playing', 'loading', 'countdown', 'reconnecting'):
                    fail('active_room', '已有进行中的房间，请先离开原房间', 409)
                self._close(old, '房主创建了新房间')
            now = self.clock()
            # Closed rooms retain no capability and can be discarded safely.
            self.rooms = {k: r for k, r in self.rooms.items()
                          if r['phase'] != 'closed' or r['expires'] > now}
            if len(self.rooms) > 1000:
                fail('capacity', '房间数量已达上限，请稍后重试', 429)
            rid, pid = secrets.token_urlsafe(16), secrets.token_urlsafe(16)
            if character not in spec['characters'] or map_id not in spec['maps']:
                fail('invalid_selection', '请选择有效的角色和地图')
            room = dict(id=rid, app=app, code=secrets.token_hex(3).upper(),
                        owner=username, host=pid, phase='lobby', map=map_id,
                        build=spec['build'], protocol=spec['protocol'], revision=0,
                        round='', starts_at=0, paused_total=0, expires=now + PLAYER_TTL,
                        notice='', disconnected={}, resume_phase='',
                        rules={'target': 10, 'duration': 180},
                        players={pid: self.player(pid, name or username, character, 'host')})
            self.rooms[rid] = room
            invite = self.invite(room, pid)
            log.info('room created app=%s room=%s', app, rid)
            return self.view(room, pid), invite

    @staticmethod
    def player(pid, name, character, role):
        return dict(id=pid, name=str(name).strip()[:24] or '先锋',
                    character=character, role=role, ready=False,
                    online=False, loaded=False)

    def invite(self, room, pid):
        with self.lock:
            if pid != room['host']:
                fail('host_only', '只有房主可以生成邀请', 403)
            if len(room['players']) >= 2:
                fail('room_full', '房间已满', 409)
            token, expires = secrets.token_urlsafe(32), self.clock() + INVITE_TTL
            with self.store.transaction() as db:
                db.execute('DELETE FROM invitations WHERE room=?', (room['id'],))
                db.execute('INSERT INTO invitations VALUES (?, ?, ?, 0)',
                           (digest(token), room['id'], expires))
                db.execute('DELETE FROM invitations WHERE expires<=?', (self.clock(),))
                db.execute('DELETE FROM visitors WHERE expires<=?', (self.clock(),))
            return dict(token=token, expires=expires)

    def redeem(self, app, rid, token, name, previous=None):
        with self.lock:
            room = self.room(app, rid)
            existing = self.store.visitor(previous, self.clock())
            if existing and existing['room'] == rid and existing['player'] in room['players']:
                return self.view(room, existing['player']), previous, existing['expires']
            if len(room['players']) >= 2:
                fail('room_full', '房间已满，请房主重新邀请', 409)
            if room['phase'] != 'lobby':
                fail('room_busy', '比赛已经开始，请稍后加入', 409)
            now = self.clock()
            pid, session = secrets.token_urlsafe(16), secrets.token_urlsafe(32)
            expires = now + PLAYER_TTL
            with self.store.transaction() as db:
                invite = db.execute('SELECT * FROM invitations WHERE hash=? AND room=?',
                                    (digest(token), rid)).fetchone()
                if not invite or invite['used'] or invite['expires'] <= now:
                    fail('invite_expired', '邀请已过期或已使用，请房主生成新邀请', 410)
                db.execute('UPDATE invitations SET used=1 WHERE hash=?', (digest(token),))
                db.execute('INSERT INTO visitors VALUES (?, ?, ?, ?, ?)',
                           (digest(session), rid, app, pid, expires))
            room['players'][pid] = self.player(pid, name, 'female', 'guest')
            room['expires'] = max(room['expires'], expires)
            log.info('guest joined app=%s room=%s', app, rid)
            self.changed(room)
            return self.view(room, pid), session, expires

    def changed(self, room):
        room['revision'] += 1
        self.notify(room)

    def _close(self, room, reason):
        if room['phase'] == 'closed':
            return
        room['phase'], room['notice'] = 'closed', reason
        self.store.revoke(room['id'])
        self.changed(room)

    def close(self):
        with self.lock:
            if self.stopped:
                return
            self.stopped = True
            for room in self.rooms.values():
                self._close(room, '房间服务已停止')
            self.store.close()

    def throttle(self, key, limit=30):
        with self.lock:
            now = self.clock()
            self.attempts = {k: [t for t in times if now - t < 60]
                             for k, times in self.attempts.items()
                             if times and now - times[-1] < 60}
            times = self.attempts.setdefault(key, [])
            if len(times) >= limit or len(self.attempts) > 4096:
                fail('rate_limited', '操作过于频繁，请稍后重试', 429)
            times.append(now)

    def asset(self, app, relative, token):
        """A guest can read only this registered game's compiled public files."""
        if self.stopped:
            return False
        try:
            visitor = self.store.visitor(token, self.clock())
            if not visitor or visitor['app'] != app:
                return False
            room = self.room(app, visitor['room'])
            if visitor['player'] not in room['players']:
                return False
            root = Path(self.definition(app)['root']).resolve()
            entry = Path(self.definition(app)['entry'])
            target = (root / relative).resolve()
            target.relative_to((root / entry.parent).resolve())
            return target.is_file() and target.suffix.lower() in {
                '.js', '.css', '.glb', '.gltf', '.bin', '.png', '.jpg', '.webp',
                '.svg', '.woff', '.woff2', '.wasm', '.json', '.ico'}
        except (RoomError, ValueError, OSError):
            return False
