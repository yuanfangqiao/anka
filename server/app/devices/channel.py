"""Thread-safe delivery, bounded actions and coalesced continuous input."""
import asyncio
import copy
import time
from collections import deque


class Channel:
    def __init__(self):
        self.loop = asyncio.get_running_loop()
        self.event = asyncio.Event()
        self.frames = deque()
        self.input = None
        self.closed = False

    def put(self, frame):
        if self.closed or self.loop.is_closed():
            return
        frame = copy.deepcopy(frame)

        def deliver():
            if self.closed:
                return
            if frame['type'] == 'input':
                if self.input:
                    for axis in ('yaw', 'pitch'):
                        frame['look'][axis] += self.input['look'][axis]
                    frame['pressedFire'] |= self.input.get('pressedFire', False)
                self.input = frame
            else:
                if frame['type'] in ('release', 'closed'):
                    self.input = None
                    self.frames = deque((t, f) for t, f in self.frames
                                        if f['type'] not in ('action', 'feedback'))
                if len(self.frames) >= 32:
                    self.closed = True
                else:
                    self.frames.append((time.monotonic(), frame))
            self.event.set()

        try:
            self.loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            self.closed = True

    async def get(self):
        while not self.closed:
            # Flush aim/move before an action so the action sees the latest view.
            if self.input:
                frame, self.input = self.input, None
                return frame
            while self.frames:
                queued, frame = self.frames.popleft()
                if frame['type'] in ('action', 'feedback') and time.monotonic() - queued > .2:
                    continue
                return frame
            self.event.clear()
            await self.event.wait()
        return {'type': 'closed', 'code': 'slow_receiver', 'message': '设备接收过慢'}
