#!/usr/bin/env python3
"""
后端冒烟验证（不启 HTTP 服务，直接驱动 PluginManager）：

  python scripts/smoke.py

断言链路：
  1. bootstrap 后 6 个插件全部 ACTIVE
  2. ctx.llm / ctx.tools / ctx.agents 服务就位
  3. 一轮对话（tool_call → bash → echo 总结）
  4. disable llm-runtime → llm-echo / agent-loop / llm-logger 级联 DISPOSED
  5. enable llm-runtime → 全部恢复 ACTIVE，服务重新可用
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from app import settings
from app.plugin_manager import PluginManager


def check(cond: bool, msg: str) -> None:
    mark = 'PASS' if cond else 'FAIL'
    print(f'  [{mark}] {msg}')
    if not cond:
        raise SystemExit(f'smoke failed: {msg}')


def main() -> None:
    # 备份 installed.json，脚本结束（无论成败）后恢复，保证可重复执行
    f = settings.INSTALLED_FILE
    backup = f.read_text(encoding='utf-8') if f.is_file() else None
    try:
        _run()
    finally:
        if backup is not None:
            f.write_text(backup, encoding='utf-8')


def _run() -> None:
    print('== 1. bootstrap ==')
    mgr = PluginManager()
    mgr.bootstrap(settings.PLUGIN_CONFIG, settings.PLUGINS_PACKAGE)

    infos = {i.name: i for i in mgr.list_plugins()}
    check(len(infos) == 8, f'8 个插件：6 infra + 2 app（实际 {len(infos)}）')
    check(all(i.state == 'ACTIVE' for i in infos.values()), '全部 ACTIVE')
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
    check('tool_call' in kinds and 'tool_result' in kinds and 'text' in kinds,
          f'事件序列含 tool_call/tool_result/text（实际 {kinds}）')
    check('[ECHO]' in result, f'回声回复（实际 {result[:40]}...）')

    print('== 4. disable llm-runtime（级联） ==')
    res = mgr.disable('llm-runtime')
    check(res.ok and res.state == 'DISPOSED', '目标 DISPOSED')
    check(set(res.cascaded) == {'llm-echo', 'agent-loop', 'llm-logger'},
          f'级联 llm-echo/agent-loop/llm-logger（实际 {res.cascaded}）')
    check(mgr.ctx.get('llm') is None, 'ctx.llm 已摘除')
    listeners = len(mgr.ctx.events._hooks.get('llm/stream', []))
    check(listeners == 0, f'llm/stream listener 已 teardown（实际 {listeners}）')

    print('== 5. enable llm-runtime（重建） ==')
    res = mgr.enable('llm-runtime')
    check(res.ok and res.state == 'ACTIVE', f'目标恢复 ACTIVE（实际 {res.state} {res.message}）')
    check(set(res.cascaded) == {'agent-loop', 'llm-echo', 'llm-logger'},
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
    check(apps['notes'].entry == '/plugins/notes/web/index.js', 'UI entry URL 正确')

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

    print('\nAll smoke checks passed.')


if __name__ == '__main__':
    main()
