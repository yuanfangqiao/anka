"""Server-owned lobby transitions. Never accept a player identity from JSON."""
import secrets

from .service import fail


def reset(room, notice=''):
    room.update(phase='lobby', round='', starts_at=0, notice=notice)
    for player in room['players'].values():
        player.update(ready=False, loaded=False)


def command(service, room, pid, action, args):
    with service.lock:
        player = room['players'][pid]
        host = pid == room['host']
        spec = service.definition(room['app'])
        if action in ('close', 'kick', 'start', 'map', 'lobby') and not host:
            fail('host_only', '只有房主可以执行这个操作', 403)
        if action == 'close':
            service._close(room, '房主关闭了房间')
            return
        if action == 'leave' and host:
            service._close(room, '房主离开了房间')
            return
        if action in ('kick', 'leave'):
            target = pid if action == 'leave' else next(
                (p for p in room['players'] if p != room['host']), None)
            if target:
                room['players'].pop(target, None)
                service.store.revoke(room['id'], target)
                reset(room, '等待新的好友加入')
        elif action == 'lobby':
            reset(room)
        elif action in ('character', 'map', 'ready'):
            if room['phase'] != 'lobby':
                fail('room_busy', '请先返回大厅', 409)
            if action == 'character':
                value = args.get('character')
                if value not in spec['characters']:
                    fail('invalid_character', '无效角色')
                player.update(character=value, ready=False)
            elif action == 'map':
                if args.get('map') not in spec['maps']:
                    fail('invalid_map', '无效地图')
                room['map'] = args['map']
                for p in room['players'].values():
                    p['ready'] = False
            else:
                if not isinstance(args.get('ready'), bool):
                    fail('invalid_ready', '准备状态无效')
                player['ready'] = args['ready']
        elif action == 'start':
            if room['phase'] != 'lobby' or len(room['players']) != 2 or not all(
                    p['online'] and p['ready'] for p in room['players'].values()):
                fail('not_ready', '需要两名玩家在线并准备好', 409)
            if spec['build'] != room['build']:
                fail('version_mismatch', '游戏已更新，请重新创建房间', 409)
            room.update(phase='loading', round=secrets.token_urlsafe(12),
                        starts_at=0, paused_total=0, notice='', loading_since=service.clock())
            for p in room['players'].values():
                p['loaded'] = False
        elif action == 'loaded':
            if room['phase'] != 'loading' or args.get('round') != room['round']:
                fail('stale_round', '本局已经变化，请重新准备', 409)
            player['loaded'] = True
            if all(p['online'] and p['loaded'] for p in room['players'].values()):
                room.update(phase='countdown', starts_at=service.clock() + 3)
        elif action == 'finished':
            if not host or room['phase'] != 'playing' or args.get('round') != room['round']:
                fail('invalid_finish', '不能结束这场比赛', 403)
            room['phase'] = 'finished'
        else:
            fail('invalid_action', '不支持的房间操作')
        service.changed(room)


def tick(service, room):
    now = service.clock()
    if room['phase'] == 'countdown' and room['starts_at'] <= now:
        room['phase'] = 'playing'
        service.changed(room)
    if room['phase'] == 'loading' and now - room.get('loading_since', now) > 60:
        reset(room, '加载超时，请重试')
        service.changed(room)
    for pid, since in list(room['disconnected'].items()):
        if now - since < 30:
            continue
        room['disconnected'].pop(pid, None)
        if pid == room['host']:
            service._close(room, '房主已离线，房间关闭')
            return
        room['players'].pop(pid, None)
        service.store.revoke(room['id'], pid)
        reset(room, '好友已离线，请重新邀请')
        service.changed(room)
