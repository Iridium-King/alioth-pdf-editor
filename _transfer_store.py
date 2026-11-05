"""Transferencias efímeras en disco con presupuesto y caducidad."""
from pathlib import Path
import tempfile
import threading
import time


class TransferStore:
    def __init__(self, clock=time.monotonic, ttl=600, max_bytes=512 * 1024 * 1024, max_items=50, directory=None):
        self.clock, self.ttl = clock, ttl
        self.max_bytes, self.max_items = max_bytes, max_items
        self.directory = directory
        self._root = None
        self._items = {}
        self._bytes = 0
        self._lock = threading.RLock()

    def cleanup(self):
        with self._lock:
            for token, (path, size, touched) in tuple(self._items.items()):
                if self.clock() - touched >= self.ttl:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        continue
                    self._items.pop(token)
                    self._bytes -= size

    def put(self, token, payload):
        with self._lock:
            self.cleanup()
            previous = self._items.get(token)
            size = len(payload)
            if (not previous and len(self._items) >= self.max_items) or self._bytes - (previous[1] if previous else 0) + size > self.max_bytes:
                raise ValueError('TRANSFER_STORE_BUSY')
            if self._root is None:
                self._root = tempfile.TemporaryDirectory(prefix='alioth-transfer-', dir=self.directory)
            path = None
            try:
                with tempfile.NamedTemporaryFile(dir=self._root.name, delete=False) as target:
                    path = Path(target.name)
                    target.write(payload)
                if previous:
                    previous[0].unlink(missing_ok=True)
                    self._bytes -= previous[1]
                self._items[token] = (path, size, self.clock())
                self._bytes += size
            except Exception:
                if path is not None:
                    path.unlink(missing_ok=True)
                raise

    def get(self, token):
        with self._lock:
            self.cleanup()
            item = self._items.get(token)
            if item is None:
                return None
            path, size, _ = item
            payload = path.read_bytes()
            self._items[token] = (path, size, self.clock())
            return payload

    def close(self):
        with self._lock:
            if self._root is not None:
                self._root.cleanup()
                self._root = None
            self._items.clear()
            self._bytes = 0
