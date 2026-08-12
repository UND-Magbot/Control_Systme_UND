# Stage 3 배포 & 라이브 테스트 런북 (NOS)

> 대상: 엘리베이터 반응 정렬 **ROS2 노드**(`elevator_align_node.py`)를 NOS(robot server
> `10.21.31.106`)에 배포하고, 실 라이다 구독 → 정렬 코어 → 속도 발행을 **안전하게 단계적**
> 으로 검증한다. 설계 근거: `DESIGN-ELEVATOR-TRANSITION` §7(토폴로지)·§8.0(좌표)·§9(파라미터)
> ·§12-A(속도 토픽)·§12.1(안전 정지 스택/워치독).
>
> **이 문서는 사람이 실행하는 절차서다.** 각 단계는 *무모션 → 미세모션 → 저속모션* 순으로
> 위험이 커진다. **앞 단계 통과기준을 못 채우면 다음으로 넘어가지 않는다.**

---

## 0. 안전 원칙 (먼저 읽기)

- **측위 off ≠ estop 무력화.** 정지는 측위와 독립(§12.1). 그래도 아래 3중 정지를 항상 확보:
  - **L0 물리 E-stop** — 로봇 본체/RM. **테스트 내내 손이 닿는 위치.** 최후 보루.
  - **L1 노드 정지** — `Ctrl-C`(SIGINT) 시 노드가 즉시 `vx=vy=ωz=0` 발행 후 종료(노드 요구사항 §0.1).
  - **L2 모션상태 정지** — `/MOTION_STATE` **SoftEStop=2** 발행(별도 터미널에서 즉시 가능).
- **워치독(W1)이 검증되기 전에는 저속 라이브(Phase E)로 가지 않는다.**
- **첫 모션은 무조건 빈 공간**(사람·장애물 없음), 짧은 거리, 저속(`v_max` 낮게).
- 발산 배선은 Stage 1 부호 회귀 테스트(§8.0-C10, 통과 완료)로 이미 걸렀지만, **실 좌표 규약
  (§12-D 축·§12-A 속도 부호)이 REP-103과 다르면** 어댑터에서 먼저 맞춘다(Phase A에서 확인).

### 0.1 노드 필수 요구사항 (배포 전 코드가 갖춰야 함)
`elevator_align_node.py` 는 아래를 **반드시** 지원해야 한다(없으면 Phase C~E 불가):
- `--dry-run` : 구독 + '낼 속도' 로그만, **발행/RL Control 진입 안 함**(무모션).
- `--max-vx / --max-vy / --max-wz` : CLI 저속 상한(기본 §9보다 낮게 시작).
- `--rate 10` : 루프 주기(Hz).
- **폴트→zero**: 예외·구독 stale·SIGINT 어디서든 즉시 `(0,0,0)` 발행 + SoftEStop.
- **RL Control 게이트**: 발행 전 `/MOTION_STATE=RLControl(17)` 확인, 아니면 발행 금지.
- **하트비트**: 매 사이클 발행(워치독이 "살아있음"을 판단하도록).

> 노드 미완성이면 먼저 오프라인 작성 + rclpy mock 글루 테스트(Stage 3-준비)부터.

---

## 1. 전제 확인

- [ ] `elevator_align_node.py` + `elevator_align/` 패키지 준비됨(§0.1 요건 충족).
- [ ] NOS 접속 정보: `NOS_HOST=10.21.31.106`, 계정=백엔드 `.env` 의 `NOS_USER/NOS_PASSWORD`.
- [ ] ROS2 셋업 스크립트: `/opt/robot/scripts/setup_ros2.sh` (root).
- [ ] 배포 위치: 릴레이와 동거(예 `/home/user/Control_system/`). **실제 경로는 A-4에서 확정.**
- [ ] 로봇이 **빈 공간**에 있고 **물리 E-stop**이 손에 닿음.
- [ ] 관찰용 터미널 2개(하나는 노드, 하나는 `topic echo`/긴급 SoftEStop 대기).

접속:
```bash
ssh <NOS_USER>@10.21.31.106
su                                   # relay 와 동일: root 필요
source /opt/robot/scripts/setup_ros2.sh
```

---

## 2. Phase A — read-only 정찰 (무모션) ★§12-A/D 해소

로봇 **정지** 상태에서 관측만. 아무것도 안 움직인다.

**A-1. 토픽 목록 — 속도 토픽 식별(§12-A):**
```bash
ros2 topic list | sort
# 기대: /LOC_BODY_POINTS /MOTION_INFO /MOTION_STATE /GAIT 등 확인.
# 속도(cmd_vel/twist/speed류) 토픽 후보를 찾는다. 이름이 드러나지 않으면:
ros2 topic list -t                   # 타입까지 표시
```

**A-2. 속도 메시지 규약 확인(§8.0-C8):**
```bash
ros2 topic info -v <VEL_TOPIC>       # publisher/subscriber, QoS
ros2 interface show <VelMsgType>     # vx/vy/ωz 필드·단위·부호
```
→ 결과를 노드 발행부에 반영. REP-103(+x전방/+y좌/CCW+)과 다르면 **어댑터에서만** 변환.

**A-3. 라이다 축 확인(§12-D):**
```bash
ros2 topic echo /LOC_BODY_POINTS --once   # 점 포맷/프레임(+x 전방인지)
ros2 topic hz  /LOC_BODY_POINTS           # ~10Hz 인지
```

**A-4. 현재 모션상태·배포 경로 확인:**
```bash
ros2 topic echo /MOTION_INFO --once       # 현재 gait/state
pgrep -af relay_map.py                     # 릴레이 실행 경로 = 배포 위치 힌트
ls -al /home/user/Control_system/          # 실제 배포 디렉토리 확인
```

**통과기준 A:** 속도 토픽·타입·부호 규약 확정, `/LOC_BODY_POINTS` 축·주기 확인, 배포 경로 확정.
하나라도 불명확하면 **여기서 멈춤**(노드 발행 대상이 정해지지 않음).

---

## 3. Phase B — 배포 (무모션)

로컬(dev repo) → NOS 복사. 릴레이와 같은 디렉토리에.
```bash
# dev 머신에서:
scp -r robot_receiver/elevator_align \
       robot_receiver/elevator_align_node.py \
       <NOS_USER>@10.21.31.106:/home/user/Control_system/
```
NOS에서 확인:
```bash
cd /home/user/Control_system
python3 -c "import ast; ast.parse(open('elevator_align_node.py').read()); print('syntax ok')"
python3 -m pytest elevator_align -q        # 코어 단위테스트 재확인(로봇 무관)
```
**통과기준 B:** 파일 존재 + 문법 OK + 코어 테스트 통과.

---

## 4. Phase C — 드라이런 (무발행·무모션) ★플러밍·코어 검증

노드가 **구독만** 하고 '낼 속도'를 로그로만 출력. **발행 안 함, RL Control 진입 안 함.**
```bash
# 로봇 정지 상태에서:
python3 elevator_align_node.py --dry-run --rate 10
```
관찰(다른 터미널):
```bash
# 노드 로그: wall_fit(back/left/right/yaw) + would-be (vx,vy,ωz) 가 합리적인지.
# 로봇을 손으로 살짝 다른 자세로 옮겨두고(전원 정지 상태), 값이 그에 맞게 변하는지.
```
검증 포인트:
- 실 엘베(또는 유사 직사각 공간) 스캔에서 **벽 3면이 잡히고**(ok=True) 거리·yaw가 실제와 부합.
- would-be 명령 **부호가 오차를 줄이는 방향**(§8.0-C10). 반대면 **축/부호 어댑터 수정 후 재시도**.
- **금속 고반사·사람** 유입 시 벽 검출이 무너지지 않는지(§4.6-1) — 무너지면 파라미터/필터 조정.

**통과기준 C:** 실 라이다에서 벽피팅 안정 + 명령 부호 정상. **여기까지 모션 0.**

> 참고: dev 머신에서 **실 스캔 JSON**만 받아 `python3 -m elevator_align.dryrun --file scan.json`
> 으로도 같은 검증 가능(로봇 완전 무관). ev_test 중 `/LOC_BODY_POINTS` 저장분을 쓰면 됨.

---

## 5. Phase D — 워치독 검증 (★첫 미세 모션, W1 게이트)

> **가장 조심할 단계.** 로봇이 처음 움직인다. **빈 공간·물리 estop 손에·저속 상한.**
> 목적: "노드가 발행을 멈추면 로봇이 **스스로 즉시 정지**하는가"(§12.1 W1) 확인.

절차:
1. 별도 터미널에 **즉시 SoftEStop** 준비:
   ```bash
   # 대기시켜 두고 위험 시 바로 실행 (relay_motion 경유):
   echo -n '{"cmd":"state","value":2}' | nc -u -w1 127.0.0.1 50003   # SoftEStop(2)
   ```
2. 극저속 미세 전진을 **아주 짧게** 명령했다가 **발행을 끊는다**:
   - 방법 A(권장): 노드에 `--watchdog-test` 모드(예: 0.05 m/s 로 0.5초 발행 후 **발행 중단**).
   - 방법 B: 수동으로 속도 토픽에 소량 1~2회 publish 후 중단.
3. 관찰: 발행 중단 순간 로봇이 **즉시 멈추면 → 워치독 OK(W1 통과)**.
   계속 미끄러지듯 나아가면 **워치독 없음 → Phase E 금지.** 즉시 estop, 노드 자체
   폴트→zero + 하트비트로 보완 가능한지 재설계(그래도 로봇측 워치독이 원칙).

**통과기준 D(W1):** 발행 중단 시 로봇 자동 정지 확인. 미충족 시 **Stage 3 라이브 중단.**

---

## 6. Phase E — 저속 라이브 (발행, 점진 확대)

> D 통과 후에만. **빈 공간·물리 estop·저속.** 한 번에 하나씩만 바꾼다.
>
> **속도 인터페이스(정찰 확정):** `drdds/msg/Steer`, 필드 **정규화 [-1,1]**
> (`x`=前后, `y`=左右, `yaw`=水平转动; z/roll/pitch=0). `--max-steer` 가 저속 상한(=최대 대비 비율, 0.08=8%%).

1. RL Control 진입 확인:
   ```bash
   timeout 1 ros2 topic echo /MOTION_INFO     # data.motion_state.state=17 인지
   # 아니면 진입: echo -n '{"cmd":"state","value":17}' | nc -u -w1 127.0.0.1 50003
   ```
2. **아주 낮은 상한(정규화 8%)** 으로 시작:
   ```bash
   python3 elevator_align_node.py --vel-topic <VEL_TOPIC> --vel-msg steer \
           --rate 10 --max-steer 0.08 --assume-rl
   ```
3. 로봇을 목표에서 **작은 오차**(예 20cm/10°)만 벗어난 자세에 두고 → 노드가 **수렴시키는지** 관찰.
   `timeout 1 ros2 topic echo /MOTION_INFO` 의 `vel_x/vel_y/vel_yaw`(실측 속도)로도 교차 확인.

> **⚠️ 발행 토픽(주입점) 확정 먼저:** `/STEER` 는 이미 내부 publisher(1)+subscriber(2)가 있어
> **직접 쏘면 충돌**. 정식 리모컨으로 움직이며 `timeout 3 ros2 topic echo /HANDLE_STEER` 로
> **외부 속도 입력이 실리는 토픽**을 확인해 그걸 `<VEL_TOPIC>` 로 쓴다. 확정 전엔 발행 금지.
4. 이상 없으면 오차·상한을 **조금씩** 키우며 반복(§9 기본값까지).
5. 매 실행 후 로그(스코어·명령·수렴 사이클) 보관.

**중단(어느 순간이든):** `Ctrl-C`(L1 zero) → 필요 시 SoftEStop(L2) → 위험하면 물리 estop(L0).

**통과기준 E:** 저속에서 여러 시작자세로 안정 수렴, 발산·과속 0, 중단 3경로 모두 동작.

---

## 7. 롤백 / 정리

- 노드 종료: `Ctrl-C`(→ zero 발행 후 종료).
- 배포 되돌리기: `rm -rf /home/user/Control_system/elevator_align /home/user/Control_system/elevator_align_node.py`
  (릴레이 스크립트는 건드리지 않는다).
- 로봇 원복: `state=Stand(1)` 또는 `Sit(4)` 로 안전 자세.
- 관찰 로그·스코어를 dev 로 회수 → 파라미터(§9) 튜닝 반영.

---

## 8. 긴급 정지 카드 (붙여두기)

| 우선 | 방법 | 명령/행동 |
|---|---|---|
| L0 | **물리 E-stop** | 본체/RM 버튼 — 항상 최우선, 측위/통신 무관 |
| L1 | 노드 정지 | 노드 터미널 `Ctrl-C` (→ 0속도 발행 후 종료) |
| L2 | SoftEStop | `echo -n '{"cmd":"state","value":2}' \| nc -u -w1 127.0.0.1 50003` |

---

## 9. 단계 게이트 요약

| Phase | 모션 | 통과기준 | 실패 시 |
|---|---|---|---|
| A 정찰 | 없음 | 속도토픽·축·주기·경로 확정 | 멈춤(발행대상 불명) |
| B 배포 | 없음 | 파일·문법·코어테스트 OK | 재복사 |
| C 드라이런 | 없음 | 벽피팅 안정 + 명령 부호 정상 | 축/부호 어댑터 수정 |
| D 워치독 | 미세 | 발행 중단 시 자동 정지(W1) | **라이브 중단** |
| E 라이브 | 저속 | 다자세 안정 수렴·중단 3경로 | 상한↓·estop·재검토 |

> **핵심: A·B·C 는 로봇 무모션(안전). 실제 위험은 D부터. D(워치독) 통과 없이는 E 금지.**
