"""로봇별 통신 엔드포인트 리졸버.

전역 ROBOT_IP/RECEIVER_IP(env) 단일 로봇 가정을 벗어나기 위한 계층.
로봇 하나가 여러 통신 대상(역할)을 가질 수 있다:

  - ASDU 로봇(M20 등): ``receiver``(백엔드가 폴링하는 NOS 중계기) + ``robot``(본체 직결)
  - X30            : ``motion`` + ``perception`` + ``nav``
  - Autoxing       : ``local``(로봇 로컬 REST/WS)

조회 우선순위(폴백 체인 — 기존 단일 로봇 동작을 100% 보존):
  1) ``robot_endpoint`` 테이블의 (RobotId, Role) 행
  2) (robot 역할) ``robot_info.RobotIP``/``RobotPort``
  3) env 전역 기본값(``config.ROBOT_IP`` / ``RECEIVER_IP`` …)

즉 아직 아무 것도 등록하지 않으면 리졸버는 기존 env 전역값을 그대로 돌려준다.
로봇별 행을 채워 넣는 만큼 통신이 로봇별로 분리된다(점진적·안전한 이행).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Optional

from app.robot_io.config import (
    ROBOT_IP,
    ROBOT_PORT,
    RECEIVER_IP,
    RECEIVER_PORT,
    RECEIVER_TCP_PORT,
)

# ── 역할 상수 ─────────────────────────────────────────────
ROLE_RECEIVER = "receiver"      # 백엔드가 폴링하는 NOS 중계기 (ASDU)
ROLE_ROBOT = "robot"            # 로봇 본체 직결 (charge / init_pose)
ROLE_MOTION = "motion"          # X30 모션호스트
ROLE_PERCEPTION = "perception"  # X30 인지호스트 (충전/고도맵)
ROLE_NAV = "nav"                # X30 내비호스트 (ROS)
ROLE_LOCAL = "local"            # Autoxing 로컬 API

VALID_ROLES = {
    ROLE_RECEIVER, ROLE_ROBOT, ROLE_MOTION, ROLE_PERCEPTION, ROLE_NAV, ROLE_LOCAL,
}


@dataclass
class Endpoint:
    """통신 대상 하나(IP + 포트 + 이기종 추가필드)."""
    ip: Optional[str] = None
    udp_port: Optional[int] = None
    tcp_port: Optional[int] = None
    extra: dict = field(default_factory=dict)

    def ok(self) -> bool:
        return bool(self.ip)

    def udp_addr(self) -> Optional[tuple[str, int]]:
        return (self.ip, self.udp_port) if self.ip and self.udp_port else None

    def tcp_addr(self) -> Optional[tuple[str, int]]:
        return (self.ip, self.tcp_port) if self.ip and self.tcp_port else None


# ── 캐시(로봇별) — DB 반복조회 방지, 등록/수정 시 무효화 ──
_cache: dict[int, dict[str, Endpoint]] = {}
_lock = threading.Lock()


def invalidate(robot_id: Optional[int] = None) -> None:
    """엔드포인트 등록/수정 후 캐시 무효화. robot_id 미지정 시 전체."""
    with _lock:
        if robot_id is None:
            _cache.clear()
        else:
            _cache.pop(robot_id, None)


def _env_fallback(role: str) -> Optional[Endpoint]:
    """DB에 아무 것도 없을 때의 전역 env 기본값(기존 단일 로봇 동작 보존)."""
    if role == ROLE_RECEIVER:
        return Endpoint(ip=RECEIVER_IP, udp_port=RECEIVER_PORT, tcp_port=RECEIVER_TCP_PORT)
    if role == ROLE_ROBOT:
        return Endpoint(ip=ROBOT_IP, udp_port=ROBOT_PORT)
    return None


def _load_from_db(robot_id: int, db) -> dict[str, Endpoint]:
    """robot_endpoint 행 + RobotInfo.RobotIP 폴백을 읽어 role→Endpoint dict 구성."""
    from app.database.models import RobotEndpoint, RobotInfo

    result: dict[str, Endpoint] = {}

    rows = db.query(RobotEndpoint).filter(RobotEndpoint.RobotId == robot_id).all()
    for row in rows:
        if not row.Ip:
            continue
        result[row.Role] = Endpoint(
            ip=row.Ip,
            udp_port=row.UdpPort,
            tcp_port=row.TcpPort,
            extra=row.Extra or {},
        )

    # robot 역할 폴백: robot_endpoint 미등록 시 RobotInfo.RobotIP/Port 사용
    if ROLE_ROBOT not in result:
        robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
        if robot and robot.RobotIP:
            result[ROLE_ROBOT] = Endpoint(ip=robot.RobotIP, udp_port=robot.RobotPort or ROBOT_PORT)

    return result


def get_endpoints(robot_id: int, db=None) -> dict[str, Endpoint]:
    """로봇의 모든 역할별 엔드포인트(캐시 사용). db 미지정 시 자체 세션."""
    if robot_id is None:
        return {}
    with _lock:
        cached = _cache.get(robot_id)
    if cached is not None:
        return cached

    own_session = db is None
    if own_session:
        from app.database.database import SessionLocal
        db = SessionLocal()
    try:
        loaded = _load_from_db(robot_id, db)
    finally:
        if own_session:
            db.close()

    with _lock:
        _cache[robot_id] = loaded
    return loaded


def resolve(robot_id: int, role: str, db=None) -> Endpoint:
    """로봇+역할의 엔드포인트 조회. DB → RobotInfo → env 순 폴백.

    항상 Endpoint 를 반환한다(비어 있을 수 있음 → ``.ok()`` 로 검사).
    """
    eps = get_endpoints(robot_id, db=db) if robot_id is not None else {}
    ep = eps.get(role)
    if ep and ep.ok():
        return ep
    fallback = _env_fallback(role)
    return fallback if fallback is not None else Endpoint()
