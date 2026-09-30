"""
cordis.registry — Inject 解析与插件元数据

对应 Cordis 的 vendor/cordis/src/registry.ts。

把用户写的 inject（list / dict）统一成 {name: config | None}。
从模块属性提取插件元数据（name / inject / provide / apply）。
"""

from typing import Optional


def resolve_inject(inject) -> dict:
    """
    归一化 inject 声明。

    list:  ['llm', 'tools']  →  {'llm': None, 'tools': None}
    dict:  {'llm': {...}}    →  {'llm': {...}}

    对应 Cordis Inject.resolve（registry.ts:71-88）。
    """
    if inject is None:
        return {}
    if isinstance(inject, (list, tuple)):
        return {n: None for n in inject}
    if isinstance(inject, dict):
        return {n: (c if c is not None else None) for n, c in inject.items()}
    return {}


class PluginMeta:
    """插件元数据"""

    def __init__(self, name, inject, provide, plugin_obj, is_service):
        self.name = name
        self.inject = inject
        self.provide = provide
        self.plugin_obj = plugin_obj
        self.is_service = is_service

    def __repr__(self):
        return (f'PluginMeta({self.name!r}, inject={list(self.inject)}, '
                f'provide={self.provide}, svc={self.is_service})')


def extract_plugin_meta(module) -> Optional[PluginMeta]:
    """
    从 Python 模块提取插件元数据。

    Service 类插件：导出继承 Service 的类
    函数插件：导出 apply 函数 + name / inject / provide
    """
    from .service import Service

    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if isinstance(attr, type) and issubclass(attr, Service) and attr is not Service:
            name = getattr(module, 'name', attr.__name__.lower())
            return PluginMeta(
                name=name,
                inject=resolve_inject(getattr(module, 'inject', None)),
                provide=getattr(module, 'provide', [name]),
                plugin_obj=attr,
                is_service=True,
            )

    if hasattr(module, 'apply') and callable(module.apply):
        name = getattr(module, 'name', module.__name__.split('.')[-1])
        return PluginMeta(
            name=name,
            inject=resolve_inject(getattr(module, 'inject', None)),
            provide=getattr(module, 'provide', []),
            plugin_obj=module.apply,
            is_service=False,
        )

    return None
