#!/usr/bin/env python3
"""
后端冒烟验证（不启 HTTP 服务，直接驱动 PluginManager）：

  python scripts/smoke.py

断言链路：
 1. bootstrap 后 10 个 infra 插件全部 ACTIVE
 2. ctx.llm / ctx.tools / ctx.agents 服务就位
 3. 一轮对话（tool_call → bash → echo 总结，含 text_delta）
 3b. TokenHub adapter 已接入（13 模型前缀注册）
 4. disable llm-runtime → llm-echo / llm-tokenhub / agent-loop / llm-logger 级联 DISPOSED
 5. enable llm-runtime → 全部恢复 ACTIVE，服务重新可用
 6-8. App 插件发现 / 通用数据通道 / 热装卸语义
 9. M14 harness 自我插件开发（scaffold→verify→install→reload→uninstall + 护栏）
 10. M15 会话日志投影（历史 / UI 气泡 / 摘要 / 删除）
 11. M15 终止（cancel 即时停下）
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from app import deps, settings


def check(cond: bool, msg: str) -> None:
    mark = 'PASS' if cond else 'FAIL'
    print(f'  [{mark}] {msg}')
    if not cond:
        raise SystemExit(f'smoke failed: {msg}')


def main() -> None:
    # 备份 installed.json，脚本结束（无论成败）后恢复，保证可重复执行
    f = settings.INSTALLED_FILE
    backup = f.read_text(encoding='utf-8') if f.is_file() else None
    from app.plugins import session_log
    known = {s['id'] for s in session_log.list_sessions()}
    try:
        _run()
    finally:
        if backup is not None:
            f.write_text(backup, encoding='utf-8')
        # 清掉本次冒烟新产生的会话，不在用户侧留垃圾
        for s in session_log.list_sessions():
            if s['id'] not in known:
                session_log.delete_session(s['id'])


def _run() -> None:
    print('== 1. bootstrap ==')
    mgr = deps.manager
    mgr.bootstrap(settings.PLUGIN_CONFIG, settings.PLUGINS_PACKAGE)

    infos = {i.name: i for i in mgr.list_plugins()}
    infra_expected = {
        'llm-runtime', 'llm-echo', 'llm-tokenhub', 'tools-runtime', 'tool-bash',
        'agent-loop', 'llm-logger', 'harness-tools', 'harness-guard', 'session-log',
        'sync-store', 'sync-hub',
    }
    check(infra_expected <= set(infos),
          f'{len(infra_expected)} 个 infra 插件全部就位（实际 {sorted(infos)}）')
    check(all(infos[n].state == 'ACTIVE' for n in infra_expected), 'infra 全部 ACTIVE')
    check(infos['agent-loop'].inject == ['llm', 'tools'], 'agent-loop inject=[llm, tools]')
    check(infos['llm-runtime'].provide == ['llm'], 'llm-runtime provide=[llm]')

    print('== 2. 服务仓库 ==')
    check(mgr.ctx.get('llm') is not None, 'ctx.llm 就位')
    check(mgr.ctx.get('tools') is not None, 'ctx.tools 就位')
    check(mgr.ctx.get('agents') is not None, 'ctx.agents 就位')
    check(mgr.ctx.get('credentials') is None, 'ctx.get(不存在) 返回 None')

    print('== 3. 一轮对话 ==')
    events = []
    result = mgr.ctx.agents.run('list files', on_event=events.append)
    kinds = [e['type'] for e in events]
    check('tool_call' in kinds and 'tool_result' in kinds and 'text_delta' in kinds,
          f'事件序列含 tool_call/tool_result/text_delta（实际 {kinds}）')
    check('[ECHO]' in result, f'回声回复（实际 {result[:40]}...）')

    print('== 3b. TokenHub adapter（M13：注册与解析，不发真实网络请求） ==')
    adapters = mgr.ctx.llm.adapters
    check('tc-code-latest' in adapters and 'glm-5.3-flash' in adapters,
          f'13 模型前缀已注册（实际 {len(adapters)} 项）')
    tokenhub = adapters.get('tc-code-latest')
    check(tokenhub is not None and all(
        adapters.get(k) is tokenhub for k in
        ('deepseek-v4-pro-202606', 'minimax-m3', 'glm-5', 'kimi-k3', 'hy4-preview')),
        '13 个模型前缀共享同一 TokenHub adapter 实例')
    check(adapters.get('echo') is not tokenhub, 'echo 与 tokenhub 是不同 adapter')

    print('== 4. disable llm-runtime（级联） ==')
    res = mgr.disable('llm-runtime')
    check(res.ok and res.state == 'DISPOSED', '目标 DISPOSED')
    check(set(res.cascaded) == {'llm-echo', 'llm-tokenhub', 'agent-loop', 'llm-logger'},
          f'级联 llm-echo/llm-tokenhub/agent-loop/llm-logger（实际 {res.cascaded}）')
    check(mgr.ctx.get('llm') is None, 'ctx.llm 已摘除')
    listeners = len(mgr.ctx.events._hooks.get('llm/stream', []))
    check(listeners == 1, f'llm/stream 仅剩 session-log 被动监听（实际 {listeners}）')

    print('== 5. enable llm-runtime（重建） ==')
    res = mgr.enable('llm-runtime')
    check(res.ok and res.state == 'ACTIVE', f'目标恢复 ACTIVE（实际 {res.state} {res.message}）')
    check(set(res.cascaded) == {'agent-loop', 'llm-echo', 'llm-tokenhub', 'llm-logger'},
          f'级联重建（实际 {res.cascaded}）')
    infos = {i.name: i for i in mgr.list_plugins()}
    check(all(i.state == 'ACTIVE' for i in infos.values()), '全部恢复 ACTIVE')
    result = mgr.ctx.agents.run('hello again')
    check('[ECHO]' in result, '重建后对话仍可用')
    fibers = [f for f in mgr.ctx.registry['fibers'] if f.name == 'llm-runtime']
    check(len(fibers) == 1, f'llm-runtime 仅 1 条 fiber 记录（实际 {len(fibers)}）')

    print('== 6. App 插件发现（M6） ==')
    manifests = mgr.discover()
    check('notes' in manifests and 'explore' in manifests,
          f'扫描发现 notes/explore（实际 {sorted(manifests)}）')
    check(manifests['notes'].ok and manifests['explore'].ok, 'plugin.json 校验通过')
    infos = {i.name: i for i in mgr.list_plugins()}
    check(infos['notes'].source == 'app' and infos['notes'].has_ui,
          'notes 标记为 app 源且带 UI')
    check(infos['llm-runtime'].source == 'infra', 'infra 插件 source=infra')
    apps = {a.id: a for a in mgr.apps()}
    check('notes' in apps and 'explore' in apps, f'/api/apps 含 notes/explore（实际 {sorted(apps)}）')
    check(apps['notes'].entry in ('/plugins/notes/web/index.js', '/plugin-dist/notes/index.js'),
          f'UI entry URL 正确（实际 {apps["notes"].entry}）')

    print('== 7. 通用数据通道 ==')
    svc = mgr.app_service('notes')
    check(svc is not None, 'ctx.notes 服务就位')
    snap = svc.snapshot()
    check(len(snap['notes']) == 4, f'笔记快照 4 条（实际 {len(snap["notes"])}）')
    note = svc.add_note('冒烟测试笔记', '由 smoke.py 写入')
    check(note['title'] == '冒烟测试笔记' and len(svc.snapshot()['notes']) == 5,
          'add_note 生效')
    svc.remove_note(note['id'])

    print('== 8. uninstall / install（M6 热语义） ==')
    res = mgr.uninstall('notes')
    check(res.ok and res.state == 'UNINSTALLED', f'notes 已卸载（实际 {res.state}）')
    check(mgr.app_service('notes') is None, '卸载后 ctx.notes 摘除')
    check(all(a.id != 'notes' for a in mgr.apps()), '卸载后 /api/apps 不含 notes')
    avail = {a.id for a in mgr.available()}
    check('notes' in avail, f'notes 进入可安装列表（实际 {sorted(avail)}）')

    res = mgr.install('notes')
    check(not res.ok and res.requires_restart,
          f'同名重装返回 requires_restart（实际 ok={res.ok} rr={res.requires_restart}）')

    res = mgr.install('explore')
    check(res.ok is False or res.message == '插件已安装', 'explore 已安装时幂等')

    print('== 9. M14 harness 自我插件开发 ==')
    tools = mgr.ctx.tools
    defs = {d['function']['name'] for d in tools.defs()}
    check('bash' in defs and 'fs_write' in defs and 'plugin_scaffold' in defs,
          f'tools.defs() 含 bash/harness 工具（实际 {sorted(defs)}）')

    r = tools.execute('plugin_scaffold', {'id': 'smoke-m14', 'name': 'SmokeM14'})
    check(str(r).startswith('已生成插件'), f'scaffold（实际 {r}）')
    r = tools.execute('plugin_verify', {'id': 'smoke-m14'})
    check(str(r).startswith('ok:'), f'verify（实际 {r}）')
    r = tools.execute('plugin_install', {'id': 'smoke-m14'})
    check(str(r).startswith('ok:'), f'install（实际 {r}）')
    r = tools.execute('plugin_reload', {'id': 'smoke-m14'})
    check(str(r).startswith('已无重启重载'), f'reload（实际 {r}）')
    r = tools.execute('plugin_uninstall', {'id': 'smoke-m14'})
    check(str(r).startswith('ok:'), f'uninstall（实际 {r}）')
    import shutil
    shutil.rmtree(settings.APP_PLUGINS_DIR / 'smoke-m14', ignore_errors=True)

    # 护栏：越界写入被单调守卫拦截
    r = tools.execute('fs_write', {'path': '../evil.txt', 'content': 'x'})
    check(str(r).startswith('denied:'), f'护栏拦截越界写入（实际 {r}）')

    print('== 10. session-log 权威事件日志（M15 多会话） ==')
    from app.plugins import session_log
    mgr.ctx.agents.run('record me', model='echo')
    sid = session_log._current_session()
    check(sid is not None, f'对话产生会话（实际 {sid}）')
    msgs = session_log.derive_messages(sid)
    check(msgs and msgs[-1].get('role') == 'assistant',
          f'可投影模型历史且以 assistant 收尾（实际 {len(msgs)} 条）')
    bubbles = session_log.session_messages(sid)
    check(any(b['role'] == 'user' for b in bubbles), '会话可投影为 UI 气泡')
    summaries = session_log.list_sessions()
    check(any(s['id'] == sid for s in summaries), '会话出现在摘要列表')
    check(session_log.delete_session(sid) and not session_log.delete_session(sid),
          '会话删除幂等')
    session_log.unbind()

    print('== 11. 终止（cancel 事件）（M15） ==')
    import threading
    cancel = threading.Event()
    cancel.set()
    events = []
    out = mgr.ctx.agents.run('stop me', model='echo',
                             on_event=events.append, cancel=cancel)
    check('已终止' in out and any(e['type'] == 'stopped' for e in events),
          f'cancel 置位即时终止（实际 {out!r}）')

    print('== 12. sync-hub 多端同步（M16） ==')
    sync = mgr.ctx.get('sync')
    check(sync is not None, 'ctx.sync 服务就位')
    import uuid
    rid = 'smoke-' + uuid.uuid4().hex[:8]
    s1, peers1 = sync.publish('smoke', rid, 'doc1', {'added': {'a': {'id': 'a'}}}, 'c1')
    s2, _ = sync.publish('smoke', rid, 'doc1', {'added': {'b': {'id': 'b'}}}, 'c2')
    check(s2 == s1 + 1, f'publish seq 单调递增（实际 {s1}→{s2}）')
    ops = sync.since('smoke', rid, 'doc1', 0)
    check([o['seq'] for o in ops] == [s1, s2],
          f'op-log 追帧（实际 {[o["seq"] for o in ops]}）')
    sync.compact('smoke', rid, 'doc1', keep=0)
    check(sync.since('smoke', rid, 'doc1', 0) == [], '压缩后清空')

    print('\nAll smoke checks passed.')


if __name__ == '__main__':
    main()
