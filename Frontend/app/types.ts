export type Video = {
    id: number;
    label: string;
}

export type Floor = {
    id: number;
    label: string;
};

export type Camera = {
    id: number;
    label: string;
    webrtcUrl: string;
    streamType?: "rtsp" | "ws";
};

export type RobotModule = {
    id: number;
    type: string;
    label: string;
    parentModuleId: number | null;
    isBuiltIn: boolean;
    isActive: boolean;
    sortOrder: number;
    config: Record<string, unknown> | null;
    createdAt?: string;
    children: RobotModule[];
};

export type PrimaryViewType = 'camera' | 'map';

export type RobotRowData = {
    id: number;
    no: string;
    info: string;
    type: string;
    battery: number;
    batteryLeft?: number;           // BatteryLevelLeft
    batteryRight?: number;          // BatteryLevelRight
    voltageLeft?: number;           // VoltageLeft
    voltageRight?: number;          // VoltageRight
    batteryTempLeft?: number;       // battery_temperatureLeft
    batteryTempRight?: number;      // battery_temperatureRight
    chargeLeft?: boolean;           // chargeLeft
    chargeRight?: boolean;          // chargeRight
    serialLeft?: string;            // serialLeft
    serialRight?: string;           // serialRight
    return: number;
    isCharging: boolean;
    chargeState: number;
    chargeStateLabel: string;
    chargeErrorCode: number;
    chargeErrorMsg: string | null;
    currentFloorId: number | null;
    currentMapId: number | null;
    position: { x: number; y: number; yaw: number; timestamp: number };
    network: 'Online' | 'Offline' | 'Error' | '-';
    power: 'On' | 'Off' | '-';                   // Sleep=0 → On, 그 외 → Off
    sleep?: number | null;                       // 원시 Sleep 값 (0=켜짐, 그 외=꺼짐)
    powerManagement?: 0 | 1 | null;              // 0=regular(배터리 2개), 1=single battery, Sleep=0일 때만 유효
    motionState?: number | null;                 // 1=Stand, 4=Sit
    isNavigating: boolean;
    mark: 'Yes' | 'No';
    tasks: RobotStatistic[];
    chargingTime: number;  // 충전 시간(분)
    waitingTime: number;   // 대기 시간(분)
    dockingTime: number;   // 도킹 시간(분)
    errors: RobotError[];
    operator: string;
    serialNumber: string;
    model: string;               
    group: string;               
    softwareVersion: string;     
    site: string;                
    registrationDateTime: string;
};

export type PowerItem = {
    id: number;
    label: string;
}

export type VideoSegment = {
    id: number;
    start: string;
    duration_sec: number;
    stream_url: string;
};

export type VideoItem = {
    // 기존 호환
    id: number;
    robotNo: string;
    cameraNo: string;
    cameraType: string;
    filename: string;
    contentType: string;
    data: string;
    videoTime: string;
    date: string;
    // 녹화 API 확장
    group_id?: string;
    robot_name?: string;
    camera_label?: string;
    record_type?: string;
    work_name?: string;
    record_start?: string;
    record_end?: string;
    total_duration_sec?: number;
    segment_count?: number;
    thumbnail_url?: string;
    streamUrl?: string;
    segments?: VideoSegment[];
    status?: string;
    error_reason?: string;
}

// VideoItem과 임시로 동일하게 적용
export type DtItem = {
    id: number;
    robotNo: string;
    cameraNo: string;
    cameraType: string;
    filename: string,
    contentType: string;
    data: string;
    videoTime: string;
    date: string;
}

export type LogCategory = "robot" | "system" | "schedule" | "error";

export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
    robot: "로봇",
    system: "시스템",
    schedule: "스케줄",
    error: "에러",
};

export type LogItem = {
    id: number;
    Category: LogCategory;
    Action: string;
    Message: string;
    Detail: string | null;
    RobotId: number | null;
    RobotName: string | null;
    CreatedAt: string;
}

export type Period = 'today' | '3days' | '1week' | '1month' | '1year' | 'Total' | null;

// 도넛 차트에 쓸 공통 타입
export type RobotType = { 
    id: number;
    label: "QUADRUPED" | "COBOT" | "AMR" | "HUMANOID";
};

export type RobotStatistic = {
  taskName: string;
  taskType: "monitoring" | "security" | "delivery" | "Facility Inspection" | string;
  taskTime: number;
}

export type RobotError = {
  errorType: "network" | "fail" | "mapping" | "etc" | string;
  count: number;
}

export type DonutCommonInfo = {
  id: number;
  label: string;
  value: number;
  percent: number;
  displayValue: string; 
};

// 탭 메뉴 관련 타입
export type TabKey = string;

export type Tab = { 
  id: TabKey;
  label: string;
};

// 캘린더 액티브 필드 타입
export type ActiveField = "start" | "end" | null;

// ────────────────────────────────────────────────────────
// 알림 (app/(pages)/alerts)
// ────────────────────────────────────────────────────────
export type AlertType = "Robot" | "Notice" | "Schedule";
export type AlertStatus = "error" | "info" | "event";
export type NoticeImportance = "high" | "normal";

export interface AlertMockData {
  id: number;
  type: AlertType;
  status?: AlertStatus;
  content: string;
  date: string;           // YYYY-MM-DD HH:mm
  robotName?: string;
  isRead: boolean;
  detail?: string;
  errorJson?: Record<string, unknown>;
  title?: string;
  author?: string;
  importance?: NoticeImportance;
  attachmentName?: string;
  attachmentUrl?: string;
  attachmentSize?: number;
  noticeId?: number;
  log?: {
    Category: string;
    Action: string;
    Message: string;
    Detail: string | null;
    RobotName: string | null;
    CreatedAt: string;
  };
}

// ────────────────────────────────────────────────────────
// 스케줄
// ────────────────────────────────────────────────────────
export type ScheduleStatus = "완료" | "진행" | "대기" | "오류" | "취소";

// ────────────────────────────────────────────────────────
// 경로/장소 (mapManagement place·path 탭에서 사용)
// ────────────────────────────────────────────────────────
export type PathRow = {
  id: number;
  robotNo: string;
  workType: string;
  pathName: string;
  pathOrder: string; // "A - B - ... - A" (첫=끝)
  updatedAt: string;
};

export type PlaceRow = {
  id: number;
  robotNo: string;
  floor: string;     // "1F", "2F", "B1" ...
  placeName: string;
  x: number;
  y: number;
  direction: number; // 방향(yaw) 각도
  updatedAt: string;
  floorId?: number | null;  // DB의 FloorInfo.id
  mapId?: number | null;    // DB의 RobotMapInfo.id (이 장소가 속한 맵)
};

// ────────────────────────────────────────────────────────
// 설정 - 메뉴 권한
// ────────────────────────────────────────────────────────
export type MenuNode = {
  id: string;             // MenuKey
  label: string;          // DB MenuName
  is_group?: boolean;     // 그룹 노드 (권한 대상 아님)
  is_visible?: boolean;   // UI 노출 여부
  sort_order?: number;    // 정렬 순서
  children?: MenuNode[];
};

export type MenuAdminRow = {
  id: number;
  menu_key: string;
  menu_name: string;
  parent_id: number | null;
  sort_order: number;
  is_group: boolean;
  is_visible: boolean;
};
