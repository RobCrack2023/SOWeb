"""In-memory registry of open chat sockets.

Lives in the process, which is fine for the single-uvicorn setup SOWeb runs.
Running several workers would need a shared broker (Redis pub/sub) instead —
each worker would only see its own connections.
"""

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        # One user can have several sockets open: two tabs, two machines.
        self._sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, socket: WebSocket) -> bool:
        """Register a socket. Returns True if this user just came online."""
        async with self._lock:
            was_offline = not self._sockets[user_id]
            self._sockets[user_id].add(socket)
            return was_offline

    async def disconnect(self, user_id: int, socket: WebSocket) -> bool:
        """Drop a socket. Returns True if this user has no sockets left."""
        async with self._lock:
            self._sockets[user_id].discard(socket)
            if not self._sockets[user_id]:
                del self._sockets[user_id]
                return True
            return False

    def online_ids(self) -> set[int]:
        return set(self._sockets.keys())

    def is_online(self, user_id: int) -> bool:
        return user_id in self._sockets

    async def send(self, user_ids: list[int], payload: dict) -> None:
        """Push an event to every socket those users have open.

        A send can fail if the peer vanished without a close frame; drop those
        sockets rather than letting one dead connection break the broadcast.
        """
        async with self._lock:
            targets = [
                (user_id, socket)
                for user_id in set(user_ids)
                for socket in self._sockets.get(user_id, set())
            ]

        dead: list[tuple[int, WebSocket]] = []
        for user_id, socket in targets:
            try:
                await socket.send_json(payload)
            except Exception:
                dead.append((user_id, socket))

        for user_id, socket in dead:
            await self.disconnect(user_id, socket)


hub = Hub()
