#!/usr/bin/env python3
"""
本地开发入口：python server/run_dev.py

- 默认带 --reload（改 app/ 下代码自动重启）+ AGENTOS_DEV=1（插件走 vite 即时编译）
- 加 --prod 参数则关 reload、不置 AGENTOS_DEV（配合 web/dist 验证生产形态：
  插件用 .plugin-dist 安装时编译产物）
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if '--prod' not in sys.argv:
    os.environ.setdefault('AGENTOS_DEV', '1')

import uvicorn

from app import settings

if __name__ == '__main__':
    prod = '--prod' in sys.argv
    uvicorn.run(
        'app.main:app',
        host=settings.HOST,
        port=settings.PORT,
        reload=not prod,
        reload_dirs=[os.path.join(os.path.dirname(__file__), 'app')],
    )
