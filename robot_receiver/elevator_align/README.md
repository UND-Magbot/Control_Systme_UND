# elevator_align — 엘리베이터 내부 정렬(반응 제어) 코어 · Stage 1

측위(전역 localization) **OFF** 상태에서, 라이다 body 스캔(`[x,y]` 점군)으로 엘베
벽/문을 **매 사이클 새로 읽어** 목표 상대자세로 수렴시키는 폐루프(반응) 제어의
**순수 알고리즘 코어**. 로봇/ROS2 비의존 → 합성 스캔으로 완전 오프라인 검증.

> 설계: `PMO_Vault/Projects/QCS_Docs/06_Planning/Elevator-Transition-and-Alignment-Design.md`
> 좌표 규약 §8.0(REP-103 기본) · 파라미터 §9 · 테스트 기준 §10 · 배포 §7/§11.

## 구성
| 파일 | 역할 |
|---|---|
| `align_target.py` | 데이터 구조·파라미터(단일 진실원천, §8.0/§9) |
| `scan_types.py` | relay_map JSON `{points:[[x,y]]}` → `ScanFrame` (실축 어댑터 훅) |
| `sim_scan.py` | 합성 엘베 스캔 생성(레이캐스팅, 문=빈 구멍, 사람 장애물) |
| `wall_fit.py` | 방위 탐색 + 절삭 min/max → back/left/right + yaw_err |
| `control_law.py` | WallFit → 오차 → 속도명령(P, body 프레임 역변환) |
| `align_core.py` | `step()`(1사이클) · `simulate_run()`(폐루프 시뮬) |
| `dryrun.py` | **READ-ONLY** 관찰기(로봇 미전송) — 합성/파일/시뮬 |
| `tests/` | pytest(벽피팅 정확도·부호 회귀·수렴) |

## 테스트
```bash
cd robot_receiver
python3 -m pytest elevator_align -q          # 11 passed
```
- `test_wall_fit` : 알려진 pose 복원(거리 <4cm, yaw <2°), 사람 장애물 견고
- `test_control_law` : **부호 회귀(§8.0-C10)** — 1스텝 후 |오차| 단조 감소(발산 배선 차단)
- `test_align_core_sim` : 임의 시작 수렴 · slip에도 수렴 · 개루프는 드리프트 잔존

## 관찰(로봇 무동작)
```bash
python3 -m elevator_align.dryrun --synth 0.9,0.15,10     # 합성 pose
python3 -m elevator_align.dryrun --sim  1.7,0.55,-22     # 폐루프 수렴 요약
python3 -m elevator_align.dryrun --file scan.json        # 실 LOC_BODY 스캔 JSON
```

## 범위·안전
- **Stage 1 = 순수 SW.** 로봇 명령 없음 → 돌발행동·estop 이슈 없음.
- 실로봇 축/속도 규약이 REP-103과 다르면 `scan_types.parse_scan(axis=...)` +
  노드 발행부(어댑터)에서만 흡수, 코어 불변(설계 §12-A/D).
- ROS2 노드(Stage 3)·백엔드 FSM(Stage 2)은 **미구현** — 이 코어를 얹을 예정.
- 실로봇 라이브 모션은 **속도 워치독(§12.1 W1) 검증 후** Stage 3에서만.

## ev_test 연계(검증)
현재 `ev_test`(B1_EV_01→B2_EV_02 UI 경로)는 `floor_transition.py`의 **S9(재측위)**
만 실행하며 이 코어를 아직 호출하지 않는다(Stage 2/3에서 연결). 안전한 검증법:
ev_test 실행 중 엘베에서 로봇의 실 `/LOC_BODY_POINTS`를 JSON으로 저장 → `dryrun --file`
로 코어가 진짜 엘베를 어떻게 읽고 어떤 명령을 낼지 **관찰만** 한다(로봇 미전송).
