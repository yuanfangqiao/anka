"""Reusable room/capability infra; each game registers its own definition."""
from app import settings
from app.cordis import Service
from app.rooms.service import RoomService
from app.rooms.transport import RoomBus

name = 'rooms'
provide = ['rooms']


class RoomsPlugin(Service, RoomService):
    def __init__(self, ctx):
        RoomService.__init__(self, settings.ROOMS_DB)
        self.bus = RoomBus(self)
        Service.__init__(self, ctx, 'rooms')
        ctx.fiber.effect(lambda: self.close, label='rooms capabilities and connections')
