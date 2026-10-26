"""日志配置"""

import logging


def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format='%(asctime)s.%(msecs)03d %(levelname)-7s %(name)s '
               '[pid=%(process)d] | %(message)s',
        datefmt='%H:%M:%S',
    )
    logging.getLogger('uvicorn.access').setLevel(logging.WARNING)
