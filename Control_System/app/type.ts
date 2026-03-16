import { DateTime } from "next-auth/providers/kakao";

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
};

export type PlusButtonType = "camera" | "map";

export type PrimaryViewType = 'camera' | 'map';

export type RobotRowData = {
    id: number;
    no: string;
    info: string;
    type: "QUADRUPED" | "COBOT" | "AMR" | "HUMANOID";   
    battery: number;
    return: number;
    isCharging: boolean;
    network: 'Online' | 'Offline' | 'Error';
    power: 'On' | 'Off';
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

export type VideoItem = {
    id: number;
    robotNo: string;
    cameraNo: string;
    cameraType: string;
    filename: string,
    contentType: string;
    data: string;
    videoTime: string;
    date: DateTime;
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
    date: DateTime;
}

export type LogItem = {
    id: number;
    robotNo: string;
    cameraNo: string;
    cameraType: string;
    filename: string,
    contentType: string;
    data: string;
    videoTime: string;
    date: DateTime;
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