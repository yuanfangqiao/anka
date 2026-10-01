"""
baidu 插件后端：BaiduService —— 纯净搜索页代理。

为什么抓 m.baidu.com（手机版）而非桌面版：
- 尺寸天然适配手机（本项目 PWA 主场景）
- feed 流 / 红包弹层 / 广告位全部由 <script> 渲染，删除脚本后
  页面只剩 logo + 搜索框 = 纯净搜索，无需任何 CSS 拼命遮盖

数据通道：snapshot() → GET /api/apps/baidu/state → {'home_html': ...}
"""

import re
import time
from urllib.request import Request, urlopen

from app.cordis import Service

name = 'baidu'
provide = ['baidu']

_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
       'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
_CACHE_TTL = 600


class BaiduService(Service):
    """百度纯净搜索页代理"""

    def __init__(self, ctx):
        super().__init__(ctx, 'baidu')
        self._cache: tuple[float, str] | None = None

    def snapshot(self) -> dict:
        return {'home_html': self._pure_home()}

    def _pure_home(self) -> str:
        if self._cache and time.time() - self._cache[0] < _CACHE_TTL:
            return self._cache[1]
        req = Request('https://m.baidu.com/', headers={
            'User-Agent': _UA,                 # 手机 UA → 返回手机版布局
            'Accept-Language': 'zh-CN,zh;q=0.9',
        })
        html = urlopen(req, timeout=8).read().decode('utf-8', 'ignore')

        # 1) 删脚本：feed/广告/弹层全靠 JS 渲染 → 全部消失；
        #    搜索框是纯 HTML 表单不受影响，且 srcdoc 与宿主同源，
        #    删脚本同时避免了对方 JS 在宿主 origin 下执行（安全）
        html = re.sub(r'<script[\s\S]*?</script>', '', html)
        # 1.5) 兜底 CSS：百度对匿名请求有时 SSR 有时 CSR 渲染 feed，
        #      两种情况都盖住（红包浮层 + feed 流 + 桌面热搜）
        html = html.replace('</head>',
                            '<style>[class*="index-banner"],#wise-index-feed,'
                            '#s-hotsearch-wrapper,[class*="s-top-ad"]'
                            '{display:none!important}</style></head>', 1)
        # 2) 相对资源 / 表单提交仍指向百度手机版
        if '<base' not in html:
            html = html.replace('<head>',
                                '<head><base href="https://m.baidu.com/">', 1)
        self._cache = (time.time(), html)
        return html
