"""Reversible device service. Game plugins register adapters through fiber effects."""
from app.cordis import Service
from app.devices.service import DeviceService

name = 'devices'
provide = ['devices']


class DevicesPlugin(Service, DeviceService):
    def __init__(self, ctx):
        DeviceService.__init__(self)
        Service.__init__(self, ctx, name)
        ctx.fiber.effect(lambda: self.close, label='device sessions and bindings')
