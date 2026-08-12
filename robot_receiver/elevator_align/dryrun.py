#!/usr/bin/env python3
"""정렬 코어 오프라인 관찰기 — 로봇 무동작, 명령을 '출력만' 한다(READ-ONLY).

용도:
  1) 합성 스캔에서 벽피팅·would-be 속도명령 확인:
       python -m elevator_align.dryrun --synth 0.9,0.1,10
  2) 파일에 저장한 실 LOC_BODY 스캔(JSON {"points":[[x,y],...]})으로 확인:
       python -m elevator_align.dryrun --file scan.json
  3) 폐루프 수렴 시뮬 요약:
       python -m elevator_align.dryrun --sim 1.6,0.5,-20

⚠️ 이 도구는 어떤 로봇 명령도 보내지 않는다. ev_test 실검증 시 '실 스캔 파일'을
넣어 코어가 진짜 엘베를 어떻게 읽는지 안전하게 관찰하는 용도.
"""
from __future__ import annotations

import argparse
import json
import math
import random

from .align_target import default_config
from .scan_types import parse_scan
from .align_core import step, simulate_run
from .sim_scan import generate_scan


def _fmt(cmd, st, wf):
    return (f"wall_fit: back={wf.back:.3f} left={wf.left:.3f} right={wf.right:.3f} "
            f"yaw={math.degrees(wf.yaw_err):+.1f}° ok={wf.ok} inl={wf.inliers}\n"
            f"error:    거리={st.err_xy:.3f}m 각={math.degrees(st.err_yaw):.1f}° -> {st.reason}\n"
            f"cmd:      vx={cmd.vx:+.3f} vy={cmd.vy:+.3f} wz={cmd.wz:+.3f}  (로봇 미전송)")


def main(argv=None):
    ap = argparse.ArgumentParser(description="정렬 코어 오프라인 관찰기(read-only)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--synth", metavar="x,y,thdeg", help="합성 스캔 pose(box 프레임)")
    g.add_argument("--file", metavar="PATH", help="LOC_BODY 스캔 JSON 파일")
    g.add_argument("--sim", metavar="x,y,thdeg", help="폐루프 수렴 시뮬 요약")
    ap.add_argument("--axis", default="rep103", help="실로봇 축 규약 어댑터(§12-D)")
    args = ap.parse_args(argv)
    cfg = default_config()

    if args.synth:
        x, y, thd = (float(v) for v in args.synth.split(","))
        scan = generate_scan(cfg.box, (x, y, math.radians(thd)), n_rays=120,
                             noise=0.006, rng=random.Random(0))
        wf, cmd, st = step(scan, cfg)
        print(f"[synth pose=({x},{y},{thd}°)  points={len(scan)}]")
        print(_fmt(cmd, st, wf))
    elif args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            raw = f.read()
        scan = parse_scan(raw, axis=args.axis)
        wf, cmd, st = step(scan, cfg)
        print(f"[file={args.file}  points={scan.count}  axis={args.axis}]")
        print(_fmt(cmd, st, wf))
    else:
        x, y, thd = (float(v) for v in args.sim.split(","))
        res = simulate_run((x, y, math.radians(thd)), cfg, max_cycles=250, noise=0.004, slip=0.0)
        print(f"[sim start=({x},{y},{thd}°)]")
        print(f"수렴={res['converged']} 사이클={res['cycles']} "
              f"최종오차 거리={res['err_xy']:.3f}m 각={math.degrees(res['err_yaw']):.1f}°")


if __name__ == "__main__":
    main()
