# 엘리베이터 반응 정렬 — 진행 상태 & 재개 가이드 (핸드오프)

> 최종 갱신: 2026-07-10. 목표 = 측위 OFF 상태에서 로봇이 **스스로** 엘베 내부 정렬(반응 제어).
> 설계: `PMO_Vault/Projects/QCS_Docs/06_Planning/Elevator-Transition-and-Alignment-Design.md`
> 배포절차: `DEPLOY_STAGE3.md`(같은 폴더). 이 문서 = 현재 상태 + 실엘베 재검증 항목.

---

## 1. 단계 상태

| 단계/조각 | 내용 | 상태 |
|---|---|---|
| Stage 1 정렬 코어(3벽) | 벽피팅·제어(sim) | ✅ 완료·검증 |
| **self-mask 필터** | 로봇 자기반사(앞/뒤 몸) 제거 | ✅ 완료·검증(실데이터) |
| **옆벽(sides) 정렬 모드** | 좌·우 벽 중앙·heading + 오도메트리 앞뒤 | ✅ 완료·검증(sim/드라이버) |
| **노드/드라이버 배선** | mode="sides" 기본 + self_mask + odom | ✅ 완료·검증 |
| Stage 2 백엔드 FSM | S3~S9·폴백·가드레일 | ✅ 완료·검증(mock) |
| Stage 3 ROS2 노드 | 라이다→드라이버→속도 | 🟡 코드 완료 / **NOS 라이브 미검증** |
| odom 실토픽 + 문턱 기준 | `/LIO_ODOM` 구독·FSM 0m | ⬜ 실엘베/FSM 통합 |
| **실 옆벽 fit_sides 검증** | 실 근접 솔리드벽서 ok=True | ⬜ **실엘베로 이연** |
| Stage 4 Jetson 비전 | 문/패널/층표시등 | ⬜ 미착수 |
| 커밋 | `feature/elevator-align-core` | ⬜ **미커밋** |

**테스트:** `cd robot_receiver && python3 -m pytest elevator_align -q` → **35 passed** ·
`cd Backend && python3 -m pytest tests/test_elevator_fsm.py -q` → **11 passed**. (시스템 python3 사용, .venv엔 pytest 없음)

---

## 2. 이 로봇의 정렬 방식 (실캡처로 확정)

**핵심: 이 로봇은 몸통이 전후로 길어 LiDAR가 자기 앞/뒤(±~60°, ~0.4~0.85m)를 가림(self-occlusion), 양옆은 트임.** → 3벽 아님, **옆벽 모드 영구**(§12.3, 환경 무관·로봇 성질).
```
좌우 중앙 + heading → 옆벽(좌·우, self-mask 후 트임)   [fit_sides]
앞뒤 깊이          → 오도메트리(문턱 기준 후진거리, d_target 기본0.55) [compute_cmd_sides]
뒷벽              → 안 봄(몸 occlusion, 필요 없음)
self(몸 앞뒤)     → self-mask 제거
폭               → 옆벽 실측 자동적응(엘베 크기 무관), 깊이만 파라미터(입력 불필요)
```

---

## 3. 신규 파일

```
robot_receiver/elevator_align/
  align_target.py  scan_types.py  sim_scan.py  wall_fit.py  control_law.py  align_core.py
  self_mask.py     # SelfMask + calibrate() + DEFAULT_SELF_MASK(실캡처서 구움)
  sides_fit.py     # fit_sides (옆벽 모드)
  node_driver.py   # AlignDriver (mode 분기·self_mask·update_odom)
  dryrun.py  DEPLOY_STAGE3.md  STATUS.md(이 파일)  README.md
  tests/  (wall_fit / control_law / align_core_sim / node_driver / steer_norm / self_mask / sides)
robot_receiver/elevator_align_node.py        # ROS2 래퍼(--mode sides 기본, --odom-depth, --dump-scan)
Backend/app/navigation/elevator_fsm.py + Backend/tests/{conftest,test_elevator_fsm}.py
```

---

## 4. 실로봇 NOS 정찰 결과 (확정)

- **속도 = `drdds/msg/Steer`** 정규화[-1,1](x前后·y左右·yaw水平转动). 노드 `--vel-msg steer`+`--max-steer`.
- **RL Control 게이트** = `MotionInfo.data.motion_state.state==17`. 실측속도 `vel_x/y/yaw`(워치독용).
- **라이다 축** = REP-103 `+x`=전방 확인. `+y`=좌 표준 가정(첫 저속 라이브서 확인).
- **self-return** = 앞/뒤 아크 ~0.4~0.85m(로봇 몸), 양옆 트임 → self-mask + 옆벽 모드로 대응.
- **발행 주입점 미확정** = `/STEER`(내부, 충돌) vs `/HANDLE_STEER`(teleop 후보) — 리모컨 echo로 확정 필요.

---

## 5. ★실 엘베 환경에서 재검증·보완 (이연 항목)

**A. 실 옆벽 fit_sides 검증**
- 즉석 렉/박스는 **LiDAR 높이에 솔리드 연속면이 아니라** 빔이 뚫려 옆벽이 안 잡힘(공장 검증 실패 원인). **실 엘베 = 솔리드 금속 근접벽 → fit_sides ok=True 예상.**
- 실엘베 진입 후 `--dump-scan` → `fit_sides(self_mask)` ok=True + left/right/y_b/yaw 실측 부합 확인.
- 필요 시 fit_sides 파라미터(min_side_inliers·max_range·edge_eps) 실데이터로 튜닝.

**B. self-mask 재캘리브(자세/HW 변경 시만)**
- 현재 마스크는 STAND 자세 캡처서 구움. **앉음↔섬·LiDAR 재장착·짐 실음** 시 `calibrate(open_space_scan)` 재실행. 공간 바뀜은 재캘리브 불필요(로봇 몸 기준).
- 더 깨끗한 순수 빈공간 STAND 캡처로 마스크 타이트닝(선택).

**C. 오도메트리 앞뒤 실연동**
- `/LIO_ODOM` 구독 → 문턱(S3 진입) 기준 0m 설정(FSM) → `driver.update_odom(depth)`. `d_target` 엘베별 확인.

**D. 발행 주입점 + 워치독(Stage 3 라이브 前)**
- 리모컨 echo로 `/HANDLE_STEER` vs `/STEER` 확정 → `build_vel_msg` steer 대상. 워치독(§12.1 W1) 실측.

**E. §6 field 항목(설계 문서)**
- 금속 정반사·거울유령(§12.2 센서사다리), LiDAR gap 문열림 신호+임계, door timeout, 단일/양문형, RealSense 장착방향, P2 허용치 튜닝.

**F. +y(좌) 축 확인** — 첫 저속 라이브서 좌우 반대로 안 가는지(§8.0-C10 회귀로 sim은 통과).

---

## 6. 재개 시 다음 액션 (택1)

- **커밋** — 지금까지(코어+self-mask+옆벽 모드+FSM+노드)를 `feature/elevator-align-core`로. ← 권장
- **실 옆벽 검증(평판/실엘베)** — 로봇 정확한 좌·우에 **LiDAR 높이 덮는 솔리드 평판** ~0.6m → dump-scan → fit_sides.
- **Stage 3 라이브 준비** — DEPLOY_STAGE3.md A~E(정찰→배포→드라이런→워치독→저속), 주입점·워치독 선행.
- **odom/FSM 통합** — /LIO_ODOM + 문턱 기준.

---

## 7. 안전 리마인더

- 측위 off ≠ estop 무력화. 3중 정지: **L0 물리 estop(손에)/L1 Ctrl-C→0/L2 SoftEStop `{"cmd":"state","value":2}` UDP 50003**.
- **워치독(W1) 통과 없이 Phase E(발행) 금지.** 첫 모션 = 빈 공간·저속(`--max-steer 0.08`).
- scp·`--dry-run`·`--dump-scan` = 무모션·무발행(안전). 발행은 Phase E뿐.

---

## 8. 참고 명령

```bash
# 실 스캔 캡처(무모션): NOS su+source 후
python3 elevator_align_node.py --dump-scan /tmp/scan.json
# 드라이런(옆벽 모드 기본, 무발행)
python3 elevator_align_node.py --dry-run
# 오프라인 스캔 분석
python3 -m elevator_align.dryrun --file /tmp/scan.json
# self-mask 재캘리브 (빈공간 STAND 캡처로)
python3 -c "import json; from elevator_align.self_mask import calibrate; \
  print(calibrate(json.load(open('/tmp/open.json'))['points']))"
```
