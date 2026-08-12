"""EV로비 seed 수렴점(basin) 진단 — 층 전환 미수렴 원인 판별.

배경: 층 전환 시 EV로비 좌표를 seed 로 INIT_POSE 를 주입하고, 로봇이 그 좌표 근처로
수렴하면 '도착'으로 본다(floor_transition). 그런데 실측에서 로봇이 seed 에서 x축으로만
2.14m(또는 6.15m) 어긋난 지점에 반복 수렴해 전환이 타임아웃으로 실패했다.
y 오차는 6cm 수준인데 x 오차만 큰 것은 복도 길이 방향 슬라이딩 오정합의 특징이다.

이 스크립트는 seed 를 x축으로 일부러 어긋나게 주입해가며 로봇이 어디에 눌러앉는지 본다.

  · 모든 주입점이 같은 한 점으로 수렴  → 그 점이 로봇의 실제 위치.
                                         즉 등록된 EV로비 POI 좌표가 틀렸다.
                                         → POI 좌표를 수렴점으로 재등록하면 해결.
  · 주입점마다 다른 곳에 눌러앉음      → 그 구간은 스캔이 x축으로 균일해 측위가 불가능.
                                         → EV로비 POI 를 특징이 있는 위치로 옮기거나
                                           맵/환경에 구조물을 보강해야 한다.

⚠️ 로봇의 '측위'만 바꾼다(INIT_POSE). 모터를 구동하지 않으므로 로봇은 움직이지 않는다.
⚠️ 실행 전 조건: 로봇을 진단 대상 EV로비에 세워두고, 그 층의 맵이 active 여야 한다.
                 주행 중이면 스크립트가 스스로 중단한다.
⚠️ 실행 중 관제 화면에 '위치 재조정' 알림이 뜰 수 있다(위치 급변 가드). 정상이며,
   스크립트가 끝나며 원래 seed 를 재주입한다. 이후 '위치 재조정'으로 확정하면 된다.

실행(컨테이너 파이썬으로 파이프, 재빌드 불필요):
    docker exec -i control-backend python - < Backend/scripts/probe_seed_basin.py
"""
import json
import math
import socket
import time

from app.robot_io.config import RECEIVER_IP, RECEIVER_PORT
from app.database.database import SessionLocal
from app.database.models import LocationInfo

# ── 설정 ──────────────────────────────────────────────
PLACE_NAME = "B2_EV_01"      # 진단할 EV로비 POI (해당 층 맵이 active 여야 함)
X_OFFSETS = [-2.0, -1.0, 0.0, 1.0, 2.0]   # seed 에 더할 x 오프셋(m)
Y_OFFSETS = [0.0]            # y축도 보려면 [-1.0, 0.0, 1.0] 등으로
SETTLE_SEC = 5.0             # 주입 후 수렴 대기
SAMPLE_COUNT = 5             # 수렴 판정용 위치 표본 수
SAMPLE_INTERVAL = 1.0
STABLE_EPS_M = 0.30          # 표본 최대 편차가 이 값 이내면 '정착'
CLUSTER_EPS_M = 0.50         # 수렴점들이 이 거리 이내면 '같은 점'으로 묶음


def _udp(payload: dict, timeout: float = 5.0) -> dict:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(json.dumps(payload).encode("utf-8"), (RECEIVER_IP, RECEIVER_PORT))
        data, _ = sock.recvfrom(4096)
        return json.loads(data.decode("utf-8"))
    finally:
        sock.close()


def read_position() -> dict | None:
    """receiver 로부터 로봇 보고 위치 1회 조회."""
    try:
        p = _udp({"action": "POSITION"})
        if not p.get("timestamp"):
            return None
        return {"x": float(p["x"]), "y": float(p["y"]), "yaw": float(p["yaw"])}
    except Exception as e:
        print(f"  [WARN] POSITION 조회 실패: {e}")
        return None


def inject(pose: dict) -> str:
    """INIT_POSE 주입. 반환: 'ok' | 'timeout' | 'error' | 'no_ack'."""
    try:
        ack = _udp({"action": "INIT_POSE", "items": pose})
        return (ack or {}).get("status", "error")
    except socket.timeout:
        return "no_ack"
    except Exception:
        return "error"


def settle() -> tuple[dict | None, float]:
    """주입 후 로봇 위치가 정착했는지 관찰. 반환 (정착위치|None, 최대편차)."""
    time.sleep(SETTLE_SEC)
    samples = []
    for _ in range(SAMPLE_COUNT):
        p = read_position()
        if p is None:
            return None, float("inf")
        samples.append(p)
        time.sleep(SAMPLE_INTERVAL)
    base = samples[0]
    dev = max(math.hypot(s["x"] - base["x"], s["y"] - base["y"]) for s in samples)
    return (samples[-1], dev) if dev <= STABLE_EPS_M else (samples[-1], dev)


def nav_is_idle() -> bool:
    try:
        return _udp({"action": "NAV_STATUS"}, timeout=3.0).get("status") == 0
    except Exception:
        return False


def load_seed(name: str) -> dict:
    db = SessionLocal()
    try:
        p = db.query(LocationInfo).filter(LocationInfo.LacationName == name).first()
        if not p:
            raise SystemExit(f"장소 '{name}' 를 찾을 수 없습니다.")
        return {"PosX": float(p.LocationX), "PosY": float(p.LocationY),
                "PosZ": 0.0, "Yaw": float(p.Yaw or 0.0), "MapId": p.MapId}
    finally:
        db.close()


def main() -> None:
    seed = load_seed(PLACE_NAME)
    print(f"진단 대상: {PLACE_NAME} (map_id={seed['MapId']})")
    print(f"등록 좌표 : x={seed['PosX']:.3f} y={seed['PosY']:.3f} yaw={seed['Yaw']:.3f}")
    print(f"receiver  : {RECEIVER_IP}:{RECEIVER_PORT}\n")

    if not nav_is_idle():
        raise SystemExit("로봇이 주행 중이거나 receiver 무응답 — 중단합니다.")

    before = read_position()
    if before is None:
        raise SystemExit("로봇 위치를 읽을 수 없습니다 — 중단합니다.")
    print(f"실행 전 보고 위치: ({before['x']:.3f}, {before['y']:.3f}, yaw={before['yaw']:.3f})\n")

    results = []
    for dy in Y_OFFSETS:
        for dx in X_OFFSETS:
            pose = {"PosX": seed["PosX"] + dx, "PosY": seed["PosY"] + dy,
                    "PosZ": 0.0, "Yaw": seed["Yaw"]}
            print(f"[주입] dx={dx:+.1f} dy={dy:+.1f} → ({pose['PosX']:.3f}, {pose['PosY']:.3f})")
            st = inject(pose)
            if st != "ok":
                print(f"  로봇이 INIT_POSE 미수락(status={st}) — 스킵\n")
                continue
            landed, dev = settle()
            if landed is None:
                print("  위치 미수신 — 스킵\n")
                continue
            d_inject = math.hypot(landed["x"] - pose["PosX"], landed["y"] - pose["PosY"])
            d_seed = math.hypot(landed["x"] - seed["PosX"], landed["y"] - seed["PosY"])
            stable = dev <= STABLE_EPS_M
            print(f"  수렴 → ({landed['x']:.3f}, {landed['y']:.3f}) "
                  f"{'정착' if stable else f'불안정(편차 {dev:.2f}m)'}")
            print(f"  주입점 대비 {d_inject:.2f}m / 등록좌표 대비 {d_seed:.2f}m\n")
            results.append({"dx": dx, "dy": dy, "landed": landed,
                            "d_inject": d_inject, "d_seed": d_seed, "stable": stable})

    # 원래 seed 재주입(실험 흔적 정리)
    print(f"[복구] 등록 좌표 재주입 → ({seed['PosX']:.3f}, {seed['PosY']:.3f})")
    inject({k: seed[k] for k in ("PosX", "PosY", "PosZ", "Yaw")})
    time.sleep(SETTLE_SEC)
    after = read_position()
    if after:
        print(f"  최종 보고 위치: ({after['x']:.3f}, {after['y']:.3f})\n")

    # ── 판정 ──
    print("=" * 66)
    if len(results) < 2:
        print("유효 표본 부족 — 로봇/receiver 상태를 확인하고 다시 실행하세요.")
        return

    print(f"{'dx':>6} {'dy':>6} {'수렴 x':>9} {'수렴 y':>9} {'주입점 대비':>11} {'정착':>5}")
    for r in results:
        print(f"{r['dx']:+6.1f} {r['dy']:+6.1f} {r['landed']['x']:9.3f} "
              f"{r['landed']['y']:9.3f} {r['d_inject']:11.2f} {'O' if r['stable'] else 'X':>5}")
    print()

    # 수렴점들이 한 점으로 모이는가?
    base = results[0]["landed"]
    spread = max(math.hypot(r["landed"]["x"] - base["x"], r["landed"]["y"] - base["y"])
                 for r in results)
    mean_x = sum(r["landed"]["x"] for r in results) / len(results)
    mean_y = sum(r["landed"]["y"] for r in results) / len(results)

    if spread <= CLUSTER_EPS_M:
        off = math.hypot(mean_x - seed["PosX"], mean_y - seed["PosY"])
        print(f"판정: 모든 주입점이 한 점으로 수렴 (산포 {spread:.2f}m).")
        print(f"      수렴점 ≈ ({mean_x:.3f}, {mean_y:.3f}), 등록 좌표와 {off:.2f}m 차이.")
        print(f"      → 로봇의 실제 위치는 수렴점이고, '{PLACE_NAME}' 등록 좌표가 틀렸습니다.")
        print(f"      → POI 좌표를 수렴점으로 재등록하면 층 전환이 통과합니다.")
    else:
        print(f"판정: 주입점마다 다른 곳에 눌러앉음 (산포 {spread:.2f}m > {CLUSTER_EPS_M}m).")
        print(f"      → 이 구간은 스캔이 균일해 측위가 성립하지 않습니다(슬라이딩 오정합).")
        print(f"      → seed 좌표를 고쳐도 해결되지 않습니다. EV로비 POI 를 특징이 있는")
        print(f"        위치로 옮기거나, 환경/맵에 구조물을 보강해야 합니다.")
    print("=" * 66)
    print("\n실행 후 관제 화면에서 '위치 재조정'으로 로봇 위치를 확정하세요.")


if __name__ == "__main__":
    main()
