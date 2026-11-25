import hmac
import json
import re
import secrets
import threading
from concurrent.futures import Future
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit


FOLDER_IDS = frozenset({"desktop", "documents", "downloads"})
MAX_REQUEST = 1024


def allowed_action(payload):
    if not isinstance(payload, dict):
        return None
    action = payload.get("action")
    if action in ("status", "screenshot") and set(payload) == {"action"}:
        return action, None
    if (action == "open_folder" and set(payload) == {"action", "folder"}
            and isinstance(payload["folder"], str) and payload["folder"] in FOLDER_IDS):
        return action, payload["folder"]
    return None


def valid_origin(origin):
    parsed = urlsplit(origin)
    return (
        parsed.netloc and not parsed.username and not parsed.password
        and not parsed.path and not parsed.query and not parsed.fragment
        and (parsed.scheme == "https" or parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"})
    )


class BridgeHandler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(2)

    def log_message(self, *_args):
        pass

    def respond(self, status, data=None, *, cors=False):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cors:
            self.send_header("Access-Control-Allow-Origin", self.server.origin)
            self.send_header("Vary", "Origin, Access-Control-Request-Private-Network")
            if self.command == "OPTIONS":
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def trusted_request(self):
        return (self.path == "/v1/action"
                and self.headers.get_all("Host") == [f"127.0.0.1:{self.server.server_port}"]
                and self.headers.get_all("Origin") == [self.server.origin])

    def do_OPTIONS(self):
        if not self.trusted_request() or self.headers.get("Access-Control-Request-Method") != "POST":
            self.respond(403)
            return
        self.respond(204, cors=True)

    def do_POST(self):
        if not self.trusted_request():
            self.respond(403)
            return
        auth = self.headers.get_all("Authorization")
        supplied = auth[0][7:] if auth and len(auth) == 1 and auth[0].startswith("Bearer ") else ""
        if not self.server.authorized(supplied):
            self.respond(401, {"error": "invalid_key"}, cors=True)
            return
        lengths = self.headers.get_all("Content-Length")
        length = lengths[0] if lengths and len(lengths) == 1 else ""
        content_types = self.headers.get_all("Content-Type") or []
        if (len(content_types) != 1 or self.headers.get_content_type() != "application/json"
                or self.headers.get("Transfer-Encoding") is not None
                or not re.fullmatch(r"[0-9]{1,4}", length) or not 0 < int(length) <= MAX_REQUEST):
            self.respond(400, {"error": "invalid_request"}, cors=True)
            return
        try:
            body = self.rfile.read(int(length))
            action = allowed_action(json.loads(body.decode("utf-8"))) if len(body) == int(length) else None
        except (ValueError, OSError):
            action = None
        if not action:
            self.respond(400, {"error": "unsupported_action"}, cors=True)
            return
        if not self.server.authorized(supplied):
            self.respond(401, {"error": "invalid_key"}, cors=True)
            return
        if action[0] == "status":
            self.respond(200, {"ok": True}, cors=True)
            return
        result = Future()
        self.server.dispatch(supplied, action, result)
        try:
            data = result.result(timeout=3)
        except TimeoutError:
            result.cancel()
            self.respond(503, {"error": "action_timeout"}, cors=True)
            return
        self.respond(200 if data.get("ok") else 409, data, cors=True)


class LocalBridge(HTTPServer):
    def __init__(self, port, origin, dispatch):
        if not valid_origin(origin):
            raise ValueError("Invalid AQL origin")
        self.origin = origin
        self.dispatch = dispatch
        self.key = ""
        super().__init__(("127.0.0.1", port), BridgeHandler)

    def authorized(self, supplied):
        key = self.key
        return bool(key and re.fullmatch(r"[A-Za-z0-9_-]{43}", supplied)
                    and hmac.compare_digest(key, supplied))

    def new_key(self):
        self.key = secrets.token_urlsafe(32)
        return self.key

    def start(self):
        threading.Thread(target=self.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True).start()

    def stop(self):
        self.key = ""
        def close():
            self.shutdown()
            self.server_close()
        threading.Thread(target=close, daemon=True).start()
