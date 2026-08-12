#!/usr/bin/env python3
"""엘리베이터 반응 정렬 ROS2 노드 — NOS(robot server)에서 라이다 옆 ~10Hz 실행.

  /LOC_BODY_POINTS (라이다 body 스캔) 구독 → AlignDriver(정렬 코어) → 속도 setpoint 발행.

★ 판단 로직은 elevator_align.node_driver.AlignDriver 에 있고(로봇 없이 pytest 검증됨),
  이 파일은 rclpy 플러밍(구독/타이머/발행/안전종료)만 담당한다.

실행(NOS):
  su
  source /opt/robot/scripts/setup_ros2.sh
  cd /home/user/Control_system            # elevator_align/ 와 동거
  # (C) 드라이런 — 발행 안 함, 무모션:
  python3 elevator_align_node.py --dry-run
  # (E) 저속 라이브 — 발행(★워치독 검증 후, 빈 공간, estop 손에):
  #   이 로봇 속도 = drdds/msg/Steer(정규화 [-1,1]: x=前后,y=左右,yaw=水平转动).
  #   <VEL_TOPIC> = /HANDLE_STEER 또는 /STEER (주입점 확정 후). --max-steer=정규화 저속상한.
  python3 elevator_align_node.py --vel-topic <VEL_TOPIC> --vel-msg steer \
          --max-steer 0.08 --assume-rl
  # (D) 워치독 검증 — 미세 전진 후 발행 중단:
  python3 elevator_align_node.py --vel-topic <VEL_TOPIC> --vel-msg steer --watchdog-test

안전(§12.1): stale/예외 → 0속도, RL Control(17) 게이트, 종료 시 0 발행.
좌표/속도 규약(§8.0-C8·§12-A/D)이 REP-103과 다르면 parse/발행 어댑터에서만 흡수.
"""
from __future__ import annotations

import argparse
import struct
import sys
import time

# 드라이버는 ROS2 없이도 import 가능(테스트 경로와 동일).
try:
    from elevator_align.node_driver import AlignDriver
    from elevator_align.align_target import AlignConfig
except Exception:  # 패키지 경로 보정(스크립트 직접 실행)
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from elevator_align.node_driver import AlignDriver
    from elevator_align.align_target import AlignConfig


def parse_pointcloud2(msg) -> list:
    """sensor_msgs/PointCloud2 → [[x,y], ...] (body 프레임). relay_map 파싱과 동일 방식.

    x,y 는 float32(offset 0,4) 가정(XYZ 필드 표준). 실측 필드가 다르면 여기서 조정(§12-D).
    """
    raw = bytes(msg.data)
    step = msg.point_step
    n = len(raw) // step if step else 0
    pts = []
    ds = max(1, n // 720)  # 과밀 시 다운샘플(~720점 상한)
    for i in range(0, n, ds):
        base = i * step
        x, y = struct.unpack_from("<ff", raw, base)
        pts.append((round(x, 3), round(y, 3)))
    return pts


def _clampf(v: float, lim: float) -> float:
    return max(-lim, min(lim, v))


def build_twist(vx: float, vy: float, wz: float):
    """geometry_msgs/Twist (표준 로봇). 이 로봇엔 Twist 속도 토픽이 없어 보통 미사용."""
    from geometry_msgs.msg import Twist
    m = Twist()
    m.linear.x = float(vx); m.linear.y = float(vy); m.angular.z = float(wz)
    return m


def to_steer_norm(vx, vy, wz, full_vx, full_vy, full_wz, max_steer):
    """m/s·rad/s → drDDS Steer 정규화 [-1,1] (前后=x, 左右平移=y, 水平转动=yaw).

    full_* = 1.0 에 대응하는 물리 최대(대략치, 라이브서 보정). max_steer = 저속 안전 상한.
    z/roll/pitch 는 평면 정렬에 미사용 → 0.
    """
    nx = _clampf(vx / full_vx if full_vx else 0.0, max_steer)
    ny = _clampf(vy / full_vy if full_vy else 0.0, max_steer)
    nyaw = _clampf(wz / full_wz if full_wz else 0.0, max_steer)
    return nx, ny, nyaw


def _vel_msg_type(kind: str):
    if kind == "twist":
        from geometry_msgs.msg import Twist
        return Twist
    if kind == "steer":
        from drdds.msg import Steer      # NOS(drDDS)에만 존재
        return Steer
    raise ValueError(f"알 수 없는 --vel-msg: {kind}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="엘리베이터 반응 정렬 ROS2 노드")
    ap.add_argument("--dry-run", action="store_true", help="발행 안 함(무모션). 코어/구독 검증")
    ap.add_argument("--rate", type=float, default=10.0, help="제어 주기 Hz")
    ap.add_argument("--scan-topic", default="/LOC_BODY_POINTS")
    ap.add_argument("--vel-topic", default="",
                    help="발행 토픽 — 이 로봇은 /HANDLE_STEER 또는 /STEER(drDDS Steer). 주입점 확정 필요")
    ap.add_argument("--vel-msg", default="steer", choices=["steer", "twist"],
                    help="이 로봇=steer(drDDS, 정규화 [-1,1]). twist는 표준 로봇용")
    ap.add_argument("--motion-info-topic", default="/MOTION_INFO")
    ap.add_argument("--max-vx", type=float, default=0.10, help="드라이버 m/s 상한(코어 클램프)")
    ap.add_argument("--max-vy", type=float, default=0.10)
    ap.add_argument("--max-wz", type=float, default=0.40)
    # steer 정규화: full-* = 1.0 에 대응하는 물리 최대(라이브서 보정), max-steer = 정규화 저속 상한
    ap.add_argument("--full-vx", type=float, default=1.0, help="steer x=1.0 에 대응하는 m/s(추정)")
    ap.add_argument("--full-vy", type=float, default=1.0)
    ap.add_argument("--full-wz", type=float, default=1.0, help="steer yaw=1.0 에 대응하는 rad/s(추정)")
    ap.add_argument("--max-steer", type=float, default=0.08,
                    help="★정규화 저속 상한(=최대속도 대비 비율). 0.08=8%%. 첫 라이브는 낮게")
    ap.add_argument("--stale-timeout", type=float, default=0.5, help="스캔 stale→0 임계(s)")
    ap.add_argument("--assume-rl", action="store_true",
                    help="RL Control(17) 확인 없이 발행 허용(신중히). 기본은 /MOTION_INFO 게이트")
    ap.add_argument("--watchdog-test", action="store_true",
                    help="미세 전진 짧게 발행 후 '발행 중단' → 로봇 자동정지(W1) 관찰")
    ap.add_argument("--dump-scan", default="",
                    help="실 LOC_BODY 스캔 1프레임을 JSON으로 저장 후 종료(읽기 전용·무발행·무모션)")
    ap.add_argument("--mode", default="sides", choices=["sides", "walls"],
                    help="정렬 모드 — 이 로봇=sides(옆벽; 몸이 앞뒤 가림). walls=3벽 일반/sim(§12.3)")
    ap.add_argument("--odom-depth", type=float, default=None,
                    help="옆벽 모드 앞뒤용 문턱기준 후진 깊이(m). 미지정=앞뒤 hold(드라이런)")
    args = ap.parse_args(argv)

    try:
        import rclpy
        from rclpy.node import Node
        from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
        from sensor_msgs.msg import PointCloud2
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] rclpy/ROS2 환경이 필요합니다(NOS에서 setup_ros2.sh source). {e}")
        return 2

    publishing = not args.dry_run and not args.dump_scan
    if publishing and not args.vel_topic:
        print("[ERROR] 발행 모드엔 --vel-topic 필요(A-1 정찰로 식별). 또는 --dry-run/--dump-scan.")
        return 2

    class AlignNode(Node):
        def __init__(self):
            super().__init__("elevator_align")
            self.driver = AlignDriver(AlignConfig(mode=args.mode), max_vx=args.max_vx,
                                      max_vy=args.max_vy, max_wz=args.max_wz,
                                      stale_timeout=args.stale_timeout)
            self.driver.update_odom(args.odom_depth)   # 드라이런=정적값(실토픽은 후속)
            self._rl_state = None
            self._wd_started = None  # watchdog-test 시작 시각
            self._frame_id = 0       # Steer 헤더용
            self._dumped = False     # dump-scan 1회 저장 플래그

            qos = QoSProfile(reliability=ReliabilityPolicy.BEST_EFFORT,
                             durability=DurabilityPolicy.VOLATILE, depth=5)
            self.create_subscription(PointCloud2, args.scan_topic, self._on_scan, qos)

            # RL Control 게이트용 상태 구독(가능하면)
            if not args.assume_rl and publishing:
                try:
                    from drdds.msg import MotionInfo
                    self.create_subscription(MotionInfo, args.motion_info_topic, self._on_motion, 10)
                except Exception as e:  # noqa: BLE001
                    self.get_logger().warn(f"MotionInfo 구독 실패({e}) — --assume-rl 없이는 발행 보류")

            self._pub = None
            if publishing:
                self._pub = self.create_publisher(_vel_msg_type(args.vel_msg), args.vel_topic, 10)

            self.create_timer(1.0 / args.rate, self._tick)
            self.get_logger().info(
                f"start: dry_run={args.dry_run} rate={args.rate} vel={args.vel_topic or '-'} "
                f"caps=({args.max_vx},{args.max_vy},{args.max_wz})")

        def _on_scan(self, msg):
            pts = parse_pointcloud2(msg)
            self.driver.update_scan(pts, time.monotonic())
            if args.dump_scan and not self._dumped:
                import json
                with open(args.dump_scan, "w") as f:
                    json.dump({"type": "loc_body", "count": len(pts), "points": pts}, f)
                self._dumped = True
                self.get_logger().info(f"[DUMP] {len(pts)}점 저장 → {args.dump_scan} (종료)")
                rclpy.shutdown()

        def _on_motion(self, msg):
            try:
                self._rl_state = int(msg.data.motion_state.state)
            except Exception:
                self._rl_state = None

        def _rl_ok(self) -> bool:
            if args.assume_rl:
                return True
            return self._rl_state == 17  # RLControl

        def _build_steer(self, vx, vy, wz):
            from drdds.msg import Steer
            m = Steer()
            # 헤더 best-effort (relay_motion 패턴: frame_id=int, stamp)
            try:
                self._frame_id += 1
                m.header.frame_id = self._frame_id
                m.header.stamp = self.get_clock().now().to_msg()
            except Exception:
                pass
            nx, ny, nyaw = to_steer_norm(vx, vy, wz, args.full_vx, args.full_vy,
                                         args.full_wz, args.max_steer)
            m.data.x = float(nx)      # 前后
            m.data.y = float(ny)      # 左右平移
            m.data.yaw = float(nyaw)  # 水平转动
            # z/roll/pitch 는 기본 0 (평면 정렬에 미사용)
            return m

        def _publish(self, vx, vy, wz):
            if self._pub is None:
                return
            msg = self._build_steer(vx, vy, wz) if args.vel_msg == "steer" \
                else build_twist(vx, vy, wz)
            self._pub.publish(msg)

        def _tick(self):
            res = self.driver.compute(time.monotonic())
            c = res.cmd

            # 워치독 검증: 초반 0.5s 만 미세 전진 발행 → 이후 발행 중단(로봇 자동정지 관찰)
            if args.watchdog_test:
                if self._wd_started is None:
                    self._wd_started = time.monotonic()
                elapsed = time.monotonic() - self._wd_started
                if elapsed < 0.5 and self._rl_ok():
                    self._publish(0.05, 0.0, 0.0)
                    self.get_logger().info(f"[WD] 미세 전진 발행 t={elapsed:.2f}")
                else:
                    self.get_logger().info("[WD] 발행 중단 — 로봇이 스스로 멈추는지 관찰(W1)")
                return

            if args.dry_run:
                extra = ""
                if args.vel_msg == "steer":
                    nx, ny, nyaw = to_steer_norm(c.vx, c.vy, c.wz, args.full_vx, args.full_vy,
                                                 args.full_wz, args.max_steer)
                    extra = f" steer(norm) x={nx:+.3f} y={ny:+.3f} yaw={nyaw:+.3f}"
                fit = ""
                if res.y_b is not None:      # sides 모드
                    import math as _m
                    fit = (f" sides(L={res.left:.2f} R={res.right:.2f} y_b={res.y_b:+.2f} "
                           f"yaw={_m.degrees(res.yaw):+.1f}°)")
                self.get_logger().info(
                    f"[DRY] mode={args.mode} ok={res.wall_ok}{fit} "
                    f"err=({res.err_xy:.3f}m,{res.err_yaw:.3f}rad) "
                    f"would-be vx={c.vx:+.3f} vy={c.vy:+.3f} wz={c.wz:+.3f}{extra} [{res.reason}]")
                return

            if not self._rl_ok():
                self.get_logger().warn(f"RL Control(17) 아님(state={self._rl_state}) — 발행 보류")
                return
            self._publish(c.vx, c.vy, c.wz)

        def safe_stop(self, n=5):
            if self._pub is None:
                return
            for _ in range(n):
                try:
                    self._publish(0.0, 0.0, 0.0)
                except Exception:
                    break
                time.sleep(0.02)

    rclpy.init()
    node = AlignNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        node.get_logger().info("SIGINT — 0속도 발행 후 종료(L1)")
    finally:
        node.safe_stop()
        node.destroy_node()
        rclpy.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
