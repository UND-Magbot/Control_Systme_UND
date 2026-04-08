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
    type: "QUADRUPED" | "COBOT" | "AMR" | "HUMANOID";
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
    network: 'Online' | 'Offline' | 'Error' | '-';
    power: 'On' | 'Off' | '-';
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
    robotIP?: string;
    robotPort?: number;
};

export type BatteryItem = {
  id: number;
  label: string;
  min?: number;   // 하한
  max?: number;   // 상한
  charging?: boolean; // 충전 상태 옵션인지 여부
};

export type NetworkItem = {
    id: number;
    label: string;
}

export type PowerItem = {
    id: number;
    label: string;
}

export type LocationItem = {
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

export type Period = 'today' | '1week' | '1month' | '1year' | 'Total' | null;

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