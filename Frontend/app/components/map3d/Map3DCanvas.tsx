"use client";

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  WebGLRenderer, Scene, PerspectiveCamera,
  AmbientLight, HemisphereLight, DirectionalLight,
  Mesh, InstancedMesh, Group, Object3D,
  PlaneGeometry, BoxGeometry, CylinderGeometry, SphereGeometry, RingGeometry, ConeGeometry, TubeGeometry, ExtrudeGeometry, Shape, Path, Vector2,
  MeshStandardMaterial,
  CanvasTexture, Color, Vector3,
  FogExp2, PCFShadowMap, ACESFilmicToneMapping, SRGBColorSpace,
  LinearFilter, DoubleSide,
  CatmullRomCurve3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CanvasMapProps } from "@/app/components/map/types";
import type { CanvasMapHandle } from "@/app/components/map/CanvasMap";
import type { ZoomAction } from "@/app/utils/zoom";
import { loadImage, processMapImage3D } from "@/app/utils/mapImageProcessor";
import { worldTo3D, getMapDimensions } from "./mapCoordinates3D";
import { createRobotModel } from "./robotModel3D";

/* ── SceneCtx ── */
type SceneCtx = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  robot: Group | null;
  robotLabel: HTMLDivElement | null;
  poiLabels: HTMLDivElement[];
  floorMesh: Mesh | null;
  pathGroup: Group | null;
  needsRender: boolean;

  animId: number;
};

const Map3DCanvas = forwardRef<CanvasMapHandle, CanvasMapProps>(function Map3DCanvas(
  {
    config, robotPos, robotName, pois, navPath, selectedPoiId,
    showRobot = false, showPois = false, showPath = false, showLabels = true,
    onPoiClick, className, style,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneCtx | null>(null);
  const [, setIsLoading] = useState(true);

  const worldToPixelScreen = useCallback(
    (wx: number, wy: number) => { const p = worldTo3D(wx, wy, config); return { x: p.x, y: p.z }; },
    [config]
  );
  const pixelToWorldScreen = useCallback(
    (px: number, py: number) => {
      const mw = config.pixelWidth * config.resolution;
      const mh = config.pixelHeight * config.resolution;
      return { x: px + config.originX + mw / 2, y: -(py - config.originY - mh / 2) };
    },
    [config]
  );
  const handleZoom = useCallback((action: ZoomAction) => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { controls } = ctx;
    if (action === "reset") {
      const { width: mapW, height: mapH } = getMapDimensions(config);
      const dist = Math.max(mapW, mapH) * 0.9;
      controls.target.set(0, 0, 0);
      controls.object.position.set(dist * 0.15, dist * 0.75, dist * 0.55);
      controls.update();
      ctx.needsRender = true;
    }
  }, [config]);
  useImperativeHandle(ref, () => ({ handleZoom, worldToPixelScreen, pixelToWorldScreen }));

  /* ═══ Scene 초기화 ═══ */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Renderer — dpr 제한, 섀도우맵 1024
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color("#12151f");
    scene.fog = new FogExp2("#12151f", 0.015);

    const { width: mapW, height: mapH } = getMapDimensions(config);
    const dist = Math.max(mapW, mapH) * 0.9;

    const camera = new PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 300);
    camera.position.set(dist * 0.15, dist * 0.75, dist * 0.55);
    camera.lookAt(0, 0, 0);

    // 조명 — 키/필 2개 + ambient/hemi (림 라이트 제거)
    scene.add(new AmbientLight("#6688bb", 0.5));
    scene.add(new HemisphereLight("#8899cc", "#223344", 0.4));

    const keyLight = new DirectionalLight("#ffffff", 0.9);
    keyLight.position.set(15, 25, 12);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 80;
    keyLight.shadow.camera.left = -25;
    keyLight.shadow.camera.right = 25;
    keyLight.shadow.camera.top = 25;
    keyLight.shadow.camera.bottom = -25;
    keyLight.shadow.bias = -0.002;
    scene.add(keyLight);

    const fillLight = new DirectionalLight("#88aaff", 0.3);
    fillLight.position.set(-8, 12, -8);
    scene.add(fillLight);

    // 아래쪽 바닥 (경계 바깥 영역)
    const basePlane = new Mesh(
      new PlaneGeometry(mapW * 2, mapH * 2),
      new MeshStandardMaterial({ color: "#0e1018", roughness: 0.95 })
    );
    basePlane.rotation.x = -Math.PI / 2;
    basePlane.position.y = 0;
    basePlane.receiveShadow = true;
    scene.add(basePlane);

    // Controls — change 이벤트로 dirty flag
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = Math.PI / 12;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 3;
    controls.maxDistance = 100;
    controls.target.set(0, 0, 0);
    controls.zoomSpeed = 0.8;
    controls.rotateSpeed = 0.6;

    let needsRender = true;
    controls.addEventListener("change", () => { needsRender = true; });

    // on-demand render loop (idle 시 0fps)
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      if (needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        needsRender = true;
      }
    });
    ro.observe(container);

    const ctx: SceneCtx = {
      renderer, scene, camera, controls,
      robot: null, robotLabel: null, poiLabels: [],
      floorMesh: null, pathGroup: null, needsRender: true, animId,
    };
    sceneRef.current = ctx;

    // 맵 로딩
    setIsLoading(true);
    loadImage(config.imageSrc)
      .then((img) => {
        if (!sceneRef.current) return;
        const processed = processMapImage3D(img, config.imageSrc);
        const { width: mw, height: mh } = getMapDimensions(config);

        const floorTex = new CanvasTexture(processed);
        floorTex.minFilter = LinearFilter;
        floorTex.magFilter = LinearFilter;
        floorTex.colorSpace = SRGBColorSpace;

        const floorMesh = new Mesh(
          new PlaneGeometry(mw, mh),
          new MeshStandardMaterial({ map: floorTex, transparent: true, roughness: 0.85, side: DoubleSide })
        );
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.y = 0.15; // 맵 내부를 높여서 3D 느낌
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);
        ctx.floorMesh = floorMesh;

        // 맵 외곽 경계 벽
        const borderMap = extractBorderFromImage(processed);
        const wallMesh = buildBorderWalls(borderMap, mw, mh);
        if (wallMesh) scene.add(wallMesh);

        needsRender = true;
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.parentNode?.removeChild(renderer.domElement);
      if (sceneRef.current) {
        sceneRef.current.robotLabel?.remove();
        sceneRef.current.poiLabels.forEach((l) => l.remove());
      }
      sceneRef.current = null;
    };
  }, [config]);

  /* ═══ Robot ═══ */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    if (ctx.robot) { ctx.scene.remove(ctx.robot); ctx.robot = null; }
    ctx.robotLabel?.remove();
    ctx.robotLabel = null;

    if (!showRobot || !robotPos) return;

    const p = worldTo3D(robotPos.x, robotPos.y, config);
    const robot = createRobotModel();
    robot.position.set(p.x, 0.15, p.z); // 맵 바닥(0.15) 위에 배치
    robot.rotation.y = -robotPos.yaw;

    // 진행 방향 화살촉 (크고 통통)
    const arrowShape = new Shape();
    arrowShape.moveTo(0.22, 0);        // 뾰족 끝
    arrowShape.lineTo(-0.08, -0.12);   // 좌하
    arrowShape.lineTo(0.0, 0);         // 안쪽 홈
    arrowShape.lineTo(-0.08, 0.12);    // 좌상
    arrowShape.closePath();

    const arrowGeo = new ExtrudeGeometry(arrowShape, {
      depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2,
    });
    const arrowMat = new MeshStandardMaterial({
      color: "#1A73E8", emissive: new Color("#1A73E8"),
      emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.3,
    });
    const arrow = new Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = -Math.PI / 2; // XY평면 → XZ평면(바닥)
    arrow.position.set(0.7, 0.01, 0);
    robot.add(arrow);
    ctx.scene.add(robot);
    ctx.robot = robot;
    ctx.needsRender = true;

    if (robotName && containerRef.current) {
      const label = mkLabel(robotName, {
        color: "#4da6ff",
        fontSize: "12px", fontWeight: "700", fontFamily: "'Inter',sans-serif",
        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
      });
      containerRef.current.appendChild(label);
      ctx.robotLabel = label;

      const update = () => {
        if (!ctx.robot || !ctx.robotLabel || !containerRef.current) return;
        project(new Vector3(p.x, 1.4, p.z), ctx.camera, containerRef.current, ctx.robotLabel, "translate(-50%,-100%)");
      };
      update();
      ctx.controls.addEventListener("change", update);
      return () => { ctx.controls.removeEventListener("change", update); };
    }
  }, [robotPos, showRobot, robotName, config]);

  /* ═══ POI ═══ */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    ctx.poiLabels.forEach((l) => l.remove());
    ctx.poiLabels = [];
    [...ctx.scene.children].filter((c) => c.userData.isPoi).forEach((c) => ctx.scene.remove(c));

    if (!showPois || !pois || pois.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const COLORS: Record<string, string> = {
      work: "#e84040", charge: "#2e9e3e", standby: "#7c4dff", waypoint: "#1a8cff", danger: "#e87800",
    };
    const updateFns: (() => void)[] = [];

    // 맵 핀 지오메트리 (납작한 판 + 구멍 — ExtrudeGeometry)
    const pinGeo = createPinGeo();
    const baseRingGeo = new RingGeometry(0.06, 0.15, 20);

    pois.forEach((poi) => {
      const pos = worldTo3D(poi.x, poi.y, config);
      const cat = poi.category || "work";
      const isSel = poi.id === selectedPoiId;
      const color = isSel ? "#64b4ff" : (COLORS[cat] ?? "#ff6b6b");

      const pinMat = new MeshStandardMaterial({
        color, emissive: new Color(color), emissiveIntensity: isSel ? 0.6 : 0.4,
        roughness: 0.1, metalness: 0.4, side: DoubleSide,
      });

      // 맵 핀 (납작한 판, 바닥 위에 서있음)
      const pin = new Mesh(pinGeo, pinMat);
      pin.position.set(pos.x, 0.15, pos.z);
      pin.userData.isPoi = true;
      ctx.scene.add(pin);

      // 핀 밑 바닥 링
      const baseRing = new Mesh(baseRingGeo, new MeshStandardMaterial({
        color, emissive: new Color(color),
        emissiveIntensity: 0.5, transparent: true, opacity: 0.6, side: DoubleSide,
      }));
      baseRing.rotation.x = -Math.PI / 2;
      baseRing.position.set(pos.x, 0.16, pos.z);
      baseRing.userData.isPoi = true;
      ctx.scene.add(baseRing);

      // HTML 라벨 (컴팩트)
      if (showLabels) {
        const label = mkLabel(poi.name, {
          color: "#fff", fontSize: "11px", fontWeight: "600", fontFamily: "'Inter',sans-serif",
          background: `${color}dd`, padding: "2px 8px", borderRadius: "4px",
          boxShadow: `0 2px 6px rgba(0,0,0,0.4)`,
          cursor: onPoiClick ? "pointer" : "default",
          pointerEvents: onPoiClick ? "auto" : "none",
        });
        if (onPoiClick) label.addEventListener("click", () => onPoiClick(poi));
        container.appendChild(label);
        ctx.poiLabels.push(label);

        const upd = () => project(new Vector3(pos.x, 0.85, pos.z), ctx.camera, container, label, "translate(-50%,-100%)");
        upd();
        updateFns.push(upd);
      }
    });

    ctx.needsRender = true;
    const onChange = () => updateFns.forEach((fn) => fn());
    ctx.controls.addEventListener("change", onChange);
    return () => { ctx.controls.removeEventListener("change", onChange); };
  }, [pois, showPois, showLabels, selectedPoiId, config, onPoiClick]);

  /* ═══ NavPath ═══ */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    if (ctx.pathGroup) { ctx.scene.remove(ctx.pathGroup); ctx.pathGroup = null; }
    if (!showPath || !navPath || navPath.segments.length === 0) return;

    const pathGroup = new Group();
    const arrowMat = new MeshStandardMaterial({
      color: "#64b4ff", emissive: new Color("#64b4ff"), emissiveIntensity: 0.5,
    });

    navPath.segments.forEach((seg) => {
      const pts = [seg.from, ...(seg.waypoints || []), seg.to].map((pt) => {
        const p = worldTo3D(pt.x, pt.y, config);
        return new Vector3(p.x, 0.03, p.z);
      });

      if (pts.length >= 2) {
        const curve = new CatmullRomCurve3(pts, false, "catmullrom", 0.5);
        const tubeGeo = new TubeGeometry(curve, pts.length * 6, 0.02, 4, false);
        const tubeMat = new MeshStandardMaterial({
          color: "#64b4ff", emissive: new Color("#3388cc"),
          emissiveIntensity: 0.3, transparent: true, opacity: 0.7, roughness: 0.3,
        });
        pathGroup.add(new Mesh(tubeGeo, tubeMat));
      }

      const mid = Math.floor(pts.length / 2);
      const from = pts[Math.max(0, mid - 1)];
      const to = pts[Math.min(pts.length - 1, mid)];
      const midPt = new Vector3().lerpVectors(from, to, 0.5);

      const coneGeo = new ConeGeometry(0.06, 0.18, 6);
      const cone = new Mesh(coneGeo, arrowMat);
      cone.position.copy(midPt).setY(0.06);
      cone.lookAt(new Vector3(to.x, 0.06, to.z));
      cone.rotateX(Math.PI / 2);
      pathGroup.add(cone);

      if (seg.direction === "two-way") {
        const cone2 = new Mesh(coneGeo, arrowMat);
        cone2.position.copy(midPt).setY(0.06);
        cone2.lookAt(new Vector3(from.x, 0.06, from.z));
        cone2.rotateX(Math.PI / 2);
        pathGroup.add(cone2);
      }
    });

    ctx.scene.add(pathGroup);
    ctx.pathGroup = pathGroup;
    ctx.needsRender = true;
  }, [navPath, showPath, config]);

  return (
    <div ref={containerRef} className={className}
      style={{ width: "100%", height: "100%", position: "relative", background: "#12151f", overflow: "hidden", ...style }}
    />
  );
});

export default Map3DCanvas;

/* ═══ 헬퍼 ═══ */

/**
 * 맵 핀 지오메트리 (납작한 판 + 가운데 구멍)
 * ExtrudeGeometry로 2D Shape를 두께만큼 돌출
 *
 * 이미지 참고: 물방울 실루엣, 가운데 원형 구멍, 광택 있는 판
 */
function createPinGeo(): ExtrudeGeometry {
  const S = 0.22;

  // 통통한 핀 (머리 크게, 테이퍼 짧게)
  const shape = new Shape();
  const headR = 0.7 * S;      // 머리 더 크게
  const headCY = 1.6 * S;     // 머리 위치 낮춰서 전체 비율 통통하게

  shape.moveTo(0, 0);

  // 왼쪽: 넓은 곡선으로 빠르게 머리에 연결
  shape.bezierCurveTo(
    -0.3 * S, 0.4 * S,
    -headR * 1.05, headCY - headR * 0.5,
    -headR, headCY
  );

  // 머리 (반원)
  shape.absarc(0, headCY, headR, Math.PI, 0, true);

  // 오른쪽: 대칭
  shape.bezierCurveTo(
    headR * 1.05, headCY - headR * 0.5,
    0.3 * S, 0.4 * S,
    0, 0
  );

  // 가운데 구멍
  const holeR = 0.32 * S;
  const hole = new Path();
  hole.absarc(0, headCY, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  // 두께 키움
  const geo = new ExtrudeGeometry(shape, {
    depth: 0.10 * S,
    bevelEnabled: true,
    bevelThickness: 0.04 * S,
    bevelSize: 0.03 * S,
    bevelSegments: 3,
  });

  // 중심 맞추기: Z축(두께)을 중앙으로, 세로(Y)로 서있도록
  // Z축(두께)만 중앙, Y축은 바닥 정렬 (뾰족 끝이 y=0)
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-( bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  return geo;
}

/**
 * 처리된 맵 이미지에서 불투명 영역의 외곽 경계 추출
 * alpha > 0 = 맵 영역, alpha = 0 = 외부
 * 맵 영역 가장자리 픽셀만 1로 마킹
 */
function extractBorderFromImage(canvas: HTMLCanvasElement): { data: Uint8Array; width: number; height: number } {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  const imgData = ctx.getImageData(0, 0, W, H).data;

  // 불투명 마스크 (alpha > 10)
  const opaque = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (imgData[i * 4 + 3] > 10) opaque[i] = 1;
  }

  // 외곽: 불투명인데 4방향 중 하나라도 투명이면 경계
  const border = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      if (!opaque[idx]) continue;
      if (!opaque[idx - 1] || !opaque[idx + 1] || !opaque[idx - W] || !opaque[idx + W]) {
        border[idx] = 1;
      }
    }
  }

  return { data: border, width: W, height: H };
}

/** 경계 데이터로 벽 InstancedMesh 생성 */
function buildBorderWalls(
  borderMap: { data: Uint8Array; width: number; height: number },
  mapWidthM: number, mapHeightM: number,
): InstancedMesh | null {
  const { data, width: pixW, height: pixH } = borderMap;
  const scaleX = mapWidthM / pixW;
  const scaleZ = mapHeightM / pixH;
  const wallH = 1.0;

  const rects: { px: number; py: number; len: number }[] = [];
  for (let y = 0; y < pixH; y++) {
    let x = 0;
    while (x < pixW) {
      if (data[y * pixW + x] === 1) {
        const sx = x;
        while (x < pixW && data[y * pixW + x] === 1) x++;
        rects.push({ px: sx, py: y, len: x - sx });
      } else { x++; }
    }
  }
  if (rects.length === 0) return null;

  const mesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({
      color: "#5a9ad8", emissive: new Color("#3366aa"), emissiveIntensity: 0.25,
      transparent: true, opacity: 0.75, roughness: 0.3,
    }),
    rects.length
  );

  const dummy = new Object3D();
  for (let i = 0; i < rects.length; i++) {
    const { px, py, len } = rects[i];
    dummy.position.set(
      (px + len / 2) * scaleX - mapWidthM / 2,
      wallH / 2,
      (py + 0.5) * scaleZ - mapHeightM / 2
    );
    dummy.scale.set(len * scaleX, wallH, scaleZ);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function mkLabel(text: string, css: Record<string, string>): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, { position: "absolute", whiteSpace: "nowrap", zIndex: "5", ...css });
  return el;
}

function project(pos: Vector3, cam: PerspectiveCamera, container: HTMLElement, el: HTMLElement, tf: string) {
  const v = pos.clone().project(cam);
  el.style.left = `${(v.x * 0.5 + 0.5) * container.clientWidth}px`;
  el.style.top = `${(-v.y * 0.5 + 0.5) * container.clientHeight}px`;
  el.style.transform = tf;
  el.style.display = v.z > 1 ? "none" : "";
}
