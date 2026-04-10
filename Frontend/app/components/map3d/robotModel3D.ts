import {
  Group, Mesh,
  BoxGeometry, CylinderGeometry, TorusGeometry, RingGeometry, SphereGeometry,
  MeshStandardMaterial,
  Color, DoubleSide, Vector3, Quaternion, Euler,
} from "three";

/**
 * DEEPRobotics Lynx — 실제 이미지 정밀 분석 모델
 *
 * 실제 로봇 측면(이미지) 분석 핵심:
 * ┌──────────────────────────────────┐
 * │  ■■ (배터리L)  ■■ (배터리R)       │ ← 등 위 좌/우 배터리
 * │  ╔══════════════════╗            │ ← 흰색 슬림 본체
 * │  ╚══════════════════╝            │
 * │ ↗ hip        hip ↖              │ ← 힙 관절 (본체 양 끝)
 * │/ upper(흰)    upper(흰)\          │ ← 상부 암: 앞다리→전방, 뒷다리→후방 경사
 * │ ○ knee        knee ○             │ ← 무릎 관절
 * │  \ lower(회)  lower(회) /         │ ← 하부 암: 더 급한 경사로 바깥쪽
 * │   ● wheel     wheel ●            │ ← 큰 바퀴, 바닥 접지
 * └──────────────────────────────────┘
 *
 * 핵심: 앞다리는 전방+외측, 뒷다리는 후방+외측으로 벌어짐 → X자 스탠스
 */

let _mat: ReturnType<typeof makeMats> | null = null;
let _geo: ReturnType<typeof makeGeos> | null = null;

function makeMats() {
  return {
    bodyWhite: new MeshStandardMaterial({ color: "#fafafa", roughness: 0.25, metalness: 0.03 }),
    bodyLight: new MeshStandardMaterial({ color: "#eaecea", roughness: 0.30, metalness: 0.05 }),
    frame: new MeshStandardMaterial({ color: "#484c52", roughness: 0.5, metalness: 0.15 }),
    battery: new MeshStandardMaterial({ color: "#2a2e34", roughness: 0.35, metalness: 0.25 }),
    batteryLid: new MeshStandardMaterial({ color: "#1c2028", roughness: 0.2, metalness: 0.4 }),
    joint: new MeshStandardMaterial({ color: "#606468", roughness: 0.4, metalness: 0.3 }),
    jointInner: new MeshStandardMaterial({ color: "#505458", roughness: 0.35, metalness: 0.35 }),
    upperLeg: new MeshStandardMaterial({ color: "#f4f4f2", roughness: 0.28, metalness: 0.03 }),
    lowerLeg: new MeshStandardMaterial({ color: "#4a4e54", roughness: 0.5, metalness: 0.15 }),
    tire: new MeshStandardMaterial({ color: "#38393b", roughness: 0.82, metalness: 0.04 }),
    tread: new MeshStandardMaterial({ color: "#2a2b2d", roughness: 0.90, metalness: 0.03 }),
    hub: new MeshStandardMaterial({ color: "#d0d2d4", roughness: 0.25, metalness: 0.3 }),
    led: new MeshStandardMaterial({
      color: "#00ccff", emissive: new Color("#0088cc"), emissiveIntensity: 0.8,
      roughness: 0.15, metalness: 0.5,
    }),
    lens: new MeshStandardMaterial({ color: "#0a1520", roughness: 0.05, metalness: 0.7 }),
    indicator: new MeshStandardMaterial({
      color: "#00ccff", emissive: new Color("#0088ff"), emissiveIntensity: 1.0,
      transparent: true, opacity: 0.7, side: DoubleSide,
    }),
  };
}

function makeGeos() {
  const S = 2.2;
  return {
    S,
    // 본체 — 납작하고 넓은 슬래브형
    bodyMain: new BoxGeometry(0.46 * S, 0.055 * S, 0.22 * S),
    bodyTop: new BoxGeometry(0.44 * S, 0.008 * S, 0.21 * S),
    bodyBottom: new BoxGeometry(0.44 * S, 0.006 * S, 0.21 * S),

    // 배터리 — 2슬롯면 + 1슬롯면
    batteryFrame: new BoxGeometry(0.24 * S, 0.055 * S, 0.002 * S),  // 감싸는 큰 테두리
    batteryOuter: new BoxGeometry(0.103 * S, 0.045 * S, 0.002 * S), // 개별 테두리
    batteryInner: new BoxGeometry(0.093 * S, 0.035 * S, 0.002 * S), // 밝은 면
    batterySlot: new BoxGeometry(0.083 * S, 0.025 * S, 0.002 * S),  // 어두운 슬롯
    batteryLed: new CylinderGeometry(0.003 * S, 0.003 * S, 0.003 * S, 6),
    batteryPort: new BoxGeometry(0.015 * S, 0.008 * S, 0.003 * S),
    // 반대쪽: 어두운 외곽 → 큰 밝은 패널 → 어두운 홈
    batteryLongOuter: new BoxGeometry(0.23 * S, 0.048 * S, 0.002 * S),  // 어두운 외곽
    batteryLongInner: new BoxGeometry(0.20 * S, 0.038 * S, 0.002 * S),  // 큰 밝은 패널 (면적 넓게)
    batteryLongSlot: new BoxGeometry(0.16 * S, 0.018 * S, 0.002 * S),   // 어두운 홈 (패널 안에 적당히)

    // 전방 카메라 — 큰 원통 1개 + 상단 작은 카메라
    camMount: new BoxGeometry(0.03 * S, 0.04 * S, 0.05 * S),                // 마운트 블록
    // 반구 — 작은 반지름, 스케일로 볼륨 조절
    camBody: new SphereGeometry(0.022 * S, 16, 12, 0, 2 * Math.PI, 0, Math.PI / 2),
    camLens: new CylinderGeometry(0.022 * S, 0.022 * S, 0.005 * S, 12),     // 렌즈 유리
    camSmall: new CylinderGeometry(0.012 * S, 0.012 * S, 0.018 * S, 12),    // 상단 작은 원형 카메라
    camSmallLens: new CylinderGeometry(0.008 * S, 0.008 * S, 0.004 * S, 8), // 작은 카메라 렌즈

    // 전방 헤드
    head: new BoxGeometry(0.02 * S, 0.035 * S, 0.07 * S),
    ledBar: new BoxGeometry(0.008 * S, 0.003 * S, 0.05 * S),

    // 관절
    hipJoint: new CylinderGeometry(0.038 * S, 0.038 * S, 0.048 * S, 16),
    hipDisc: new CylinderGeometry(0.044 * S, 0.044 * S, 0.010 * S, 16),
    kneeJoint: new CylinderGeometry(0.034 * S, 0.034 * S, 0.044 * S, 16),
    kneeDisc: new CylinderGeometry(0.040 * S, 0.040 * S, 0.009 * S, 16),

    // 다리 (더 길게)
    upperArm: new BoxGeometry(0.042 * S, 0.17 * S, 0.048 * S),
    lowerArm: new BoxGeometry(0.038 * S, 0.16 * S, 0.044 * S),

    // 바퀴 — 실제: 검정 고무 타이어 + 큰 흰색 허브캡
    tire: new CylinderGeometry(0.06 * S, 0.06 * S, 0.04 * S, 24),          // 타이어 외곽
    tireRim: new CylinderGeometry(0.055 * S, 0.055 * S, 0.042 * S, 24),    // 림 (타이어 안쪽 단차)
    hubCap: new CylinderGeometry(0.045 * S, 0.045 * S, 0.008 * S, 20),     // 큰 흰색 허브캡
    hubRing: new CylinderGeometry(0.048 * S, 0.048 * S, 0.004 * S, 20),    // 허브 외곽 링
    hubDot: new CylinderGeometry(0.008 * S, 0.008 * S, 0.01 * S, 8),       // 허브 중앙 볼트

    indicatorRing: new RingGeometry(0.01 * S, 0.045 * S, 12),
  };
}

/**
 * 두 점 사이에 봉(arm)을 배치하는 헬퍼
 * p1(시작) → p2(끝) 사이 중앙에 위치, 방향 맞춤
 */
function placeLimb(
  mesh: Mesh,
  p1: Vector3,
  p2: Vector3,
): void {
  const mid = new Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  mesh.position.copy(mid);

  const dir = new Vector3().subVectors(p2, p1).normalize();
  const up = new Vector3(0, 1, 0);
  const quat = new Quaternion().setFromUnitVectors(up, dir);
  mesh.quaternion.copy(quat);
}

export function createRobotModel(): Group {
  if (!_mat) _mat = makeMats();
  if (!_geo) _geo = makeGeos();
  const m = _mat;
  const g = _geo;
  const S = g.S;

  const root = new Group();

  function mk(geo: BoxGeometry | CylinderGeometry | TorusGeometry | RingGeometry | SphereGeometry,
    mt: MeshStandardMaterial): Mesh {
    const mesh = new Mesh(geo, mt);
    mesh.castShadow = true;
    return mesh;
  }

  function addAt(geo: BoxGeometry | CylinderGeometry | TorusGeometry | RingGeometry | SphereGeometry, mt: MeshStandardMaterial, x: number, y: number, z: number): Mesh {
    const mesh = mk(geo, mt);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  }

  /*
   * 좌표 설계 (S=2.2 적용 전, 미터 단위)
   *
   * 바퀴 반지름 = 0.06
   * 바퀴 바닥 = 0 (지면)
   * 바퀴 중심 Y = 0.06
   *
   * 역산:
   * wheelCenter.y = 0.06
   * knee.y ≈ 0.06 + lowerLen*cos(lowerAngle)
   * hip.y ≈ knee.y + upperLen*cos(upperAngle) → bodyCenter.y
   */

  // 기본 치수
  const wheelR = 0.06;
  const groundY = wheelR; // 바퀴 중심

  // 다리 길이
  const upperLen = 0.17;
  const lowerLen = 0.16;

  // 본체 Y (바닥에서 역산)
  // 하부: 35도 경사 → 수직 높이 = lowerLen * cos(35°) ≈ 0.131
  // 상부: 25도 경사 → 수직 높이 = upperLen * cos(25°) ≈ 0.154
  // body center Y ≈ groundY + 0.131 + 0.154 = 0.345
  const bodyY = 0.345;
  const bodyH = 0.055;

  /* ═══ 본체 (납작 슬래브) ═══ */
  addAt(g.bodyMain, m.bodyWhite, 0, bodyY * S, 0);
  addAt(g.bodyTop, m.bodyLight, 0, (bodyY + bodyH / 2 + 0.005) * S, 0);
  addAt(g.bodyBottom, m.frame, 0, (bodyY - bodyH / 2 - 0.004) * S, 0);

  /* ═══ 배터리 (좌측: 2슬롯, 우측: 1긴슬롯) ═══ */
  const battZ = 0.11;
  const battXOffsets = [0.058, -0.058];

  [-1, 1].forEach((side) => {
    const z = side * battZ * S;
    const zOut = side * (battZ + 0.001) * S;
    const zOut2 = side * (battZ + 0.002) * S;
    const zOut3 = side * (battZ + 0.003) * S;
    const zOut4 = side * (battZ + 0.004) * S;

    // 감싸는 큰 프레임 (양쪽 동일)
    addAt(g.batteryFrame, m.frame, 0, bodyY * S, z);

    if (side === 1) {
      // 우측(+Z): 2슬롯 (기존)
      battXOffsets.forEach((bx) => {
        addAt(g.batteryOuter, m.joint, bx * S, bodyY * S, zOut);
        addAt(g.batteryInner, m.bodyLight, bx * S, bodyY * S, zOut2);
        addAt(g.batterySlot, m.battery, bx * S, bodyY * S, zOut3);

        [-0.015, -0.007, 0.001, 0.009].forEach((lx) => {
          const dot = mk(g.batteryLed, m.hub);
          dot.rotation.x = Math.PI / 2;
          dot.position.set((bx + lx) * S, (bodyY + 0.005) * S, zOut4);
          root.add(dot);
        });

        const port = mk(g.batteryPort, m.frame);
        port.position.set((bx + 0.025) * S, (bodyY + 0.005) * S, zOut4);
        root.add(port);
      });
    } else {
      // 좌측(-Z): 어두운 외곽 → 어두운 중간 → 밝은 내부
      addAt(g.batteryLongOuter, m.joint, 0, bodyY * S, zOut);
      addAt(g.batteryLongInner, m.battery, 0, bodyY * S, zOut2);
      addAt(g.batteryLongSlot, m.bodyLight, 0, bodyY * S, zOut3);
    }
  });

  /* ═══ 전방 카메라 (반원통 + 상단 작은 카메라) ═══ */
  // 본체 X 반폭 = 0.46/2 = 0.23 → 앞 측면에 밀착
  const camX = 0.23;

  // 반구 (전방 볼록 돌출, 위아래 높이 축소)
  const camBody = mk(g.camBody, m.lowerLeg);
  camBody.rotation.z = -Math.PI / 2;
  // X=전방 돌출(볼륨 유지), Y=위아래(줄임), Z=좌우(줄임)
  // X=전방 돌출(볼륨), Y=위아래(본체높이 안), Z=좌우 폭
  camBody.scale.set(2.5, 0.9, 1.2);
  camBody.position.set(camX * S, bodyY * S, 0);
  root.add(camBody);

  // 상단 작은 원형 카메라
  const camSmall = mk(g.camSmall, m.frame);
  camSmall.rotation.z = Math.PI / 2;
  camSmall.position.set((camX + 0.01) * S, (bodyY + 0.035) * S, 0);
  root.add(camSmall);

  // 작은 카메라 렌즈
  const camSmallLens = mk(g.camSmallLens, m.lens);
  camSmallLens.rotation.z = Math.PI / 2;
  camSmallLens.position.set((camX + 0.02) * S, (bodyY + 0.035) * S, 0);
  root.add(camSmallLens);

  /* ═══ 전방 LED (반원 아래) ═══ */
  addAt(g.ledBar, m.led, 0.23 * S, (bodyY - 0.03) * S, 0);

  /* ═══ 4족 다리 ═══
   *
   * 실제 측면 이미지 정밀 분석:
   *
   *   [본체]
   *    hip ──── hip
   *   /              \         ← 상부 암: 모두 뒤쪽+아래로 경사
   *  knee          knee
   *  /                  \      ← 하부 암: 앞다리=앞으로, 뒷다리=뒤로
   * wheel            wheel
   *
   * 앞다리: 상부 뒤로 → 무릎에서 앞으로 꺾임 (Z자)
   * 뒷다리: 상부 뒤로 → 무릎에서 더 뒤로 (역Z자)
   *
   * 결과: 바퀴가 본체보다 앞/뒤로 넓게 벌어진 안정적 스탠스
   */
  const legCfg = [
    //          hipX    hipZ   outZ  upperDir  lowerDir
    // 앞다리: 상부=뒤(-1), 하부=앞(+1)
    { hipX: 0.18, hipZ: 0.10, outZ: 1, upperDir: -1, lowerDir: 1 },   // FR
    { hipX: 0.18, hipZ: -0.10, outZ: -1, upperDir: -1, lowerDir: 1 },  // FL
    // 뒷다리: 상부=앞(+1), 하부=뒤(-1) → Z자 꺾임
    { hipX: -0.18, hipZ: 0.10, outZ: 1, upperDir: 1, lowerDir: -1 },  // RR
    { hipX: -0.18, hipZ: -0.10, outZ: -1, upperDir: 1, lowerDir: -1 }, // RL
  ];

  const upperAng = 0.55;  // 상부 경사 ~31도
  const lowerAng = 0.50;  // 하부 경사 ~29도
  const spreadZ = 0.35;   // 외측 벌어짐
  const lowerSpreadZ = 0.12;

  legCfg.forEach(({ hipX, hipZ, outZ, upperDir, lowerDir }) => {
    const leg = new Group();

    const hipPos = new Vector3(0, bodyY - bodyH / 2, 0);

    // 힙 관절
    const hipM = mk(g.hipJoint, m.joint);
    hipM.rotation.x = Math.PI / 2;
    hipM.position.set(0, hipPos.y * S, outZ * 0.015 * S);
    leg.add(hipM);

    const hipD = mk(g.hipDisc, m.jointInner);
    hipD.rotation.x = Math.PI / 2;
    hipD.position.set(0, hipPos.y * S, outZ * 0.05 * S);
    leg.add(hipD);

    // ── 상부 암 (흰색, 뒤쪽+아래+외측) ──
    const kneePos = new Vector3(
      upperDir * Math.sin(upperAng) * upperLen,
      hipPos.y - Math.cos(upperAng) * upperLen,
      outZ * Math.sin(spreadZ) * upperLen,
    );

    const upperArm = mk(g.upperArm, m.upperLeg);
    placeLimb(
      upperArm,
      new Vector3(0, hipPos.y * S, 0),
      new Vector3(kneePos.x * S, kneePos.y * S, kneePos.z * S),
    );
    leg.add(upperArm);

    // 무릎 관절
    const kneeM = mk(g.kneeJoint, m.joint);
    kneeM.rotation.x = Math.PI / 2;
    kneeM.position.set(kneePos.x * S, kneePos.y * S, kneePos.z * S);
    leg.add(kneeM);

    const kneeD = mk(g.kneeDisc, m.jointInner);
    kneeD.rotation.x = Math.PI / 2;
    kneeD.position.set(kneePos.x * S, kneePos.y * S, (kneePos.z + outZ * 0.028) * S);
    leg.add(kneeD);

    // ── 하부 암 (진한 회색, Z자 꺾임) ──
    const wheelPos = new Vector3(
      kneePos.x + lowerDir * Math.sin(lowerAng) * lowerLen,
      groundY,
      kneePos.z + outZ * Math.sin(lowerSpreadZ) * lowerLen,
    );

    const lowerArm = mk(g.lowerArm, m.lowerLeg);
    placeLimb(
      lowerArm,
      new Vector3(kneePos.x * S, kneePos.y * S, kneePos.z * S),
      new Vector3(wheelPos.x * S, wheelPos.y * S, wheelPos.z * S),
    );
    leg.add(lowerArm);

    // ── 바퀴 (타이어 + 림 + 큰 흰색 허브캡) ──
    const wx = wheelPos.x * S, wy = wheelPos.y * S, wz = wheelPos.z * S;

    // 타이어 외곽 (검정 고무)
    const tire = mk(g.tire, m.tire);
    tire.rotation.x = Math.PI / 2;
    tire.position.set(wx, wy, wz);
    leg.add(tire);

    // 림 (타이어 안쪽 단차, 약간 다른 색)
    const rim = mk(g.tireRim, m.tread);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(wx, wy, wz);
    leg.add(rim);

    // 허브캡 (양쪽, 큰 흰색 원판 — 실제 이미지처럼)
    [-1, 1].forEach((side) => {
      // 외곽 링
      const ring = mk(g.hubRing, m.joint);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(wx, wy, wz + side * 0.019 * S);
      leg.add(ring);

      // 큰 흰색 허브
      const hub = mk(g.hubCap, m.hub);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(wx, wy, wz + side * 0.020 * S);
      leg.add(hub);

      // 중앙 볼트
      const dot = mk(g.hubDot, m.frame);
      dot.rotation.x = Math.PI / 2;
      dot.position.set(wx, wy, wz + side * 0.024 * S);
      leg.add(dot);
    });

    leg.position.set(hipX * S, 0, hipZ * S);
    root.add(leg);
  });

  /* 방향 인디케이터 링 제거됨 — 화살촉으로 대체 */

  return root;
}
