#!/usr/bin/env python3
"""가상 M20 — 관제가 보는 로봇(NOS receiver)을 흉내 내는 시뮬레이터.

실기기(M20·RM 팔) 없이 관제 로직 전체를 검증하기 위한 도구다.
설계: 06_Planning/SIM-Virtual-Robot-Simulator-Plan.md

관제는 상대가 진짜인지 시뮬인지 모른다 — "이 IP:포트로 JSON 을 보내면 JSON 이 온다"가
전부이기 때문이다. 그래서 백엔드 코드를 한 줄도 안 고치고 붙일 수 있다.

    python3 fake_nos.py --x 3.965 --y -2.395 --yaw -1.664

관제 쪽 설정(둘 다 필요 — 주소 해석 경로가 두 갈래다):
    .env            RECEIVER_IP / ROBOT_IP 를 이 스크립트가 도는 호스트로
    관제 UI         시뮬 전용 로봇을 등록하고 RobotIP 를 같은 값으로

⚠️ 이건 **로봇의 물리 거동만** 흉내 낸다. 경유지 사이 궤적은 직선이라 지도에서 벽을
   통과한다. 검증 대상은 관제의 판정 로직(도착·복귀·세션·집계)이지 경로계획이 아니다.
"""
from __future__ import annotations

import argparse
import json
import math
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

# ── 관제가 쓰는 기본값 (robot_io/config.py 와 일치) ──
UDP_PORT = 40000          # RECEIVER_PORT — 상태·폴링·STOP·NAV 폴백
TCP_PORT = 40001          # RECEIVER_TCP_PORT — NAV 주 경로
CTRL_PORT = 40099         # 이 시뮬레이터의 조작 손잡이(HTTP)

# 도착 판정이 성립하려면 이동이 "보여야" 한다.
#   백엔드: status!=0 을 한 번이라도 봐야 ever_moved=True (polling.py:521)
#           그 뒤 status==0 연속 3회(ARRIVAL_CONFIRM_COUNT) + 1.5초(ARRIVAL_COOLDOWN)
#   폴링 주기 1초(NAV_POLL_INTERVAL) → 이동이 4~5초는 걸려야 안전하다.
#   즉시 도착시키면 ever_moved 가 안 잡혀 near-skip 분기로 빠진다(판정 경로가 달라짐).
ARRIVE_EPS = 0.20         # 목표 이 거리 안이면 도착
TICK = 0.1


class Robot:
    """가상 로봇 상태. 모든 접근은 _lock 아래에서."""

    def __init__(self, x: float, y: float, yaw: float, battery: int):
        self._lock = threading.RLock()
        self.x, self.y, self.yaw = x, y, yaw
        self.battery = battery
        self.target: dict | None = None
        self.nav_status = 0          # 0=정지, 1=이동중, 255=일시정지
        self.last_nav_change = time.monotonic()
        self.started = time.monotonic()

        # ── 조작 손잡이 (실기기로는 못 만드는 상황을 만든다) ──
        self.speed = 0.5             # m/s. 0 이면 제자리 = 무진전 180초 판정 검증
        self.reply_status = True     # False = STATUS 무응답 → 오프라인 판정(35초) 검증
        self.reply_nav_ack = True    # False = NAV ack 없음 → 명령 유실 검증
        self.hold_moving = False     # True = 도착해도 status 를 1로 유지 → 세션 상한·연장 검증

    # ── 상태 조회 ──
    def snapshot(self) -> dict:
        with self._lock:
            return {"x": self.x, "y": self.y, "yaw": self.yaw,
                    "battery": self.battery, "nav_status": self.nav_status,
                    "target": dict(self.target) if self.target else None,
                    "speed": self.speed, "reply_status": self.reply_status,
                    "reply_nav_ack": self.reply_nav_ack, "hold_moving": self.hold_moving}

    def _nav_age(self) -> float:
        return time.monotonic() - self.last_nav_change

    # ── 명령 ──
    def set_target(self, idx: int, x: float, y: float, yaw: float) -> None:
        with self._lock:
            self.target = {"idx": idx, "x": float(x), "y": float(y), "yaw": float(yaw)}
            self.nav_status = 1
            self.last_nav_change = time.monotonic()
        print(f"[SIM] NAV 수신 idx={idx} → ({x:.2f}, {y:.2f}) yaw={yaw:.2f}")

    def stop(self, reason: str = "") -> None:
        with self._lock:
            self.target = None
            self.nav_status = 0
            self.last_nav_change = time.monotonic()
        print(f"[SIM] 정지{' — ' + reason if reason else ''}")

    def teleport(self, x: float, y: float, yaw: float, why: str) -> None:
        """위치를 즉시 옮긴다. INIT_POSE(층 전환 seed) 를 '사람이 태워줬다'로 흉내 낼 때 쓴다."""
        with self._lock:
            self.x, self.y, self.yaw = float(x), float(y), float(yaw)
        print(f"[SIM] 위치 점프 → ({x:.2f}, {y:.2f}) yaw={yaw:.2f}  ({why})")

    # ── 물리 틱 ──
    def tick(self, dt: float) -> None:
        with self._lock:
            tgt, spd = self.target, self.speed
            if tgt is None or spd <= 0:
                return
            dx, dy = tgt["x"] - self.x, tgt["y"] - self.y
            dist = math.hypot(dx, dy)

            if dist <= ARRIVE_EPS:
                self.x, self.y, self.yaw = tgt["x"], tgt["y"], tgt["yaw"]
                self.target = None
                if not self.hold_moving and self.nav_status != 0:
                    self.nav_status = 0
                    self.last_nav_change = time.monotonic()
                    print(f"[SIM] 목표 도달 idx={tgt['idx']} → status=0")
                return

            step = min(spd * dt, dist)
            self.x += dx / dist * step
            self.y += dy / dist * step
            self.yaw = math.atan2(dy, dx)

    # ── 관제 요청 처리 ──
    def handle(self, req: dict) -> dict | None:
        """관제 요청 → 응답(dict). None 이면 응답하지 않는다(fire-and-forget/무응답 흉내)."""
        action = (req.get("action") or "").upper()

        if action == "POSITION":
            with self._lock:
                # timestamp>0 이어야 관제가 채택한다 (polling.py:143)
                return {"x": round(self.x, 4), "y": round(self.y, 4),
                        "yaw": round(self.yaw, 4), "timestamp": time.time()}

        if action == "STATUS":
            if not self.reply_status:
                return None          # 무응답 → 35초 뒤 오프라인 확정
            with self._lock:
                bat = self.battery
            return {
                "timestamp": time.time(),     # 8초 넘게 낡으면 stale 판정
                "BatteryStatus": {"BatteryPercentage": bat, "BatteryVoltage": 48.0},
                "ChargeStatus": 0,
                "DeviceTemperature": {},
                # ⚠️ Sleep 이 핵심이다. runtime._derive_power 는 **Sleep==0 일 때만 "On"**
                # 으로 판정한다(없거나 0이 아니면 Off). 이게 빠지면 폴링이 정상이어도
                # 화면에는 전원 Off 로 보인다.
                "BasicStatus": {
                    "timestamp": time.time(),
                    "Sleep": 0,               # 0 = 깨어 있음
                    "PowerManagement": 0,
                    "MotionState": 0,
                },
                "MotionInfo": {},
                "AbnormalStatus": [],
            }

        if action == "NAV_STATUS":
            with self._lock:
                # age 는 receiver 자기 시계 기준 경과(초). 5초 넘으면 관제가 stale 로 버린다.
                return {"status": self.nav_status, "age": round(self._nav_age(), 2)}

        if action == "NAV":
            idx = int(req.get("idx", 0))
            self.set_target(idx, req.get("x", 0.0), req.get("y", 0.0), req.get("yaw", 0.0))
            if not self.reply_nav_ack:
                return None
            return {"ack": True, "idx": idx}

        if action == "INIT_POSE":
            # 층 전환 seed. 'ok' 를 주고 그 좌표로 점프하면 = 사람이 태워 내려놓은 것(ASSISTED).
            items = req.get("items") or {}
            self.teleport(items.get("PosX", 0.0), items.get("PosY", 0.0),
                          items.get("Yaw", 0.0), "INIT_POSE seed")
            return {"status": "ok", "response": "simulated"}

        if action in ("STOP", "EMERGENCY_STOP"):
            self.stop(action)
            return None

        if action in ("STAND", "SIT", "UP", "DOWN", "LEFT", "RIGHT",
                      "LEFTTURN", "RIGHTTURN"):
            print(f"[SIM] 동작 명령: {action}")
            return None

        print(f"[SIM] 미지원 action(무시): {action}")
        return None


# ── 서버들 ────────────────────────────────────────────────────────────────

def udp_server(robot: Robot, host: str, port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    print(f"[SIM] UDP {host}:{port} 대기")
    while True:
        try:
            data, addr = sock.recvfrom(8192)
            req = json.loads(data.decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - 깨진 패킷에 죽지 않는다
            print(f"[SIM] UDP 파싱 실패(무시): {str(e)[:60]}")
            continue
        resp = robot.handle(req)
        if resp is not None:
            sock.sendto(json.dumps(resp).encode("utf-8"), addr)


def tcp_server(robot: Robot, host: str, port: int) -> None:
    """NAV 주 경로. 관제는 TCP 를 먼저 시도하고 실패해야 UDP 로 폴백한다."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, port))
    srv.listen(8)
    print(f"[SIM] TCP {host}:{port} 대기 (NAV)")
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=_tcp_conn, args=(robot, conn), daemon=True).start()


def _tcp_conn(robot: Robot, conn: socket.socket) -> None:
    with conn:
        conn.settimeout(5.0)
        try:
            data = conn.recv(8192)
            if not data:
                return
            req = json.loads(data.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"[SIM] TCP 파싱 실패(무시): {str(e)[:60]}")
            return
        resp = robot.handle(req)
        if resp is not None:
            try:
                conn.sendall(json.dumps(resp).encode("utf-8"))
            except OSError:
                pass


def physics_loop(robot: Robot) -> None:
    last = time.monotonic()
    while True:
        time.sleep(TICK)
        now = time.monotonic()
        robot.tick(now - last)
        last = now


# ── 조작 손잡이 (HTTP) ────────────────────────────────────────────────────

class _Ctrl(BaseHTTPRequestHandler):
    robot: Robot = None  # type: ignore[assignment]

    def log_message(self, *a):  # noqa: ARG002 - 요청마다 stderr 로 찍지 않는다
        pass

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") in ("", "/state"):
            self._json(200, self.robot.snapshot())
        else:
            self._json(404, {"error": "GET /state"})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:  # noqa: BLE001
            self._json(400, {"error": "잘못된 JSON"})
            return

        path = self.path.rstrip("/")
        r = self.robot
        with r._lock:  # noqa: SLF001 - 같은 모듈 내 의도된 접근
            if path == "/speed":
                r.speed = float(body.get("value", 0.5))
            elif path == "/status-reply":
                r.reply_status = bool(body.get("value", True))
            elif path == "/nav-ack":
                r.reply_nav_ack = bool(body.get("value", True))
            elif path == "/hold-moving":
                r.hold_moving = bool(body.get("value", False))
            elif path == "/battery":
                r.battery = int(body.get("value", 100))
            elif path == "/teleport":
                pass  # 아래에서 락 밖으로
            else:
                self._json(404, {"error": "speed|status-reply|nav-ack|hold-moving|battery|teleport"})
                return

        if path == "/teleport":
            r.teleport(body.get("x", 0.0), body.get("y", 0.0), body.get("yaw", 0.0), "수동")

        print(f"[SIM] 손잡이 {path} ← {body}")
        self._json(200, r.snapshot())


def ctrl_server(robot: Robot, host: str, port: int) -> None:
    _Ctrl.robot = robot
    HTTPServer((host, port), _Ctrl).serve_forever()


# ── 진입점 ────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="가상 M20 (NOS receiver 시뮬레이터)")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--udp-port", type=int, default=UDP_PORT)
    ap.add_argument("--tcp-port", type=int, default=TCP_PORT)
    ap.add_argument("--ctrl-port", type=int, default=CTRL_PORT)
    # 기본 위치는 robot_io/config.py 의 INIT_POSE 와 동일
    ap.add_argument("--x", type=float, default=3.965)
    ap.add_argument("--y", type=float, default=-2.395)
    ap.add_argument("--yaw", type=float, default=-1.664)
    ap.add_argument("--speed", type=float, default=0.5, help="m/s. 0 이면 제자리(무진전 검증)")
    ap.add_argument("--battery", type=int, default=87)
    args = ap.parse_args()

    robot = Robot(args.x, args.y, args.yaw, args.battery)
    robot.speed = args.speed

    for fn, a in ((udp_server, (robot, args.host, args.udp_port)),
                  (tcp_server, (robot, args.host, args.tcp_port)),
                  (ctrl_server, (robot, args.host, args.ctrl_port)),
                  (physics_loop, (robot,))):
        threading.Thread(target=fn, args=a, daemon=True).start()

    print(f"[SIM] 가상 M20 기동 — 위치({args.x:.2f}, {args.y:.2f}) 속도 {args.speed} m/s")
    print(f"[SIM] 손잡이: curl http://<host>:{args.ctrl_port}/state")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\n[SIM] 종료")


if __name__ == "__main__":
    main()
