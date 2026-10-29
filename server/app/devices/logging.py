"""Device query credentials must never enter access/error logs."""
import logging
import re


class RedactDeviceTokens(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        if '/v1/device/' in message:
            message = re.sub(r'(?i)(token(?:=|%3d))[^&\s"\']+', r'\1[REDACTED]', message)
        if 'resumeToken' in message:
            message = re.sub(r'''(["']resumeToken["']\s*:\s*["'])[^"']+''', r'\1[REDACTED]', message)
        if message != record.getMessage():
            record.msg = message
            record.args = ()
        return True


def install_redaction():
    for name in ('uvicorn.access', 'uvicorn.error', 'anka.devices', 'httpx', 'httpcore'):
        logger = logging.getLogger(name)
        if not any(isinstance(item, RedactDeviceTokens) for item in logger.filters):
            logger.addFilter(RedactDeviceTokens())
