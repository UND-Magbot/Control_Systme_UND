export type AlertType = "Robot" | "Notice" | "Schedule";
export type AlertStatus = "error" | "info" | "event";

export type NoticeImportance = "high" | "normal";

export interface AlertMockData {
  id: number;
  type: AlertType;
  status?: AlertStatus;   // Schedule 등 상태가 없는 경우 optional
  content: string;
  date: string;           // YYYY-MM-DD HH:mm
  robotName?: string;     // Robot 타입일 때 주로 사용
  isRead: boolean;        // 읽음/미읽음
  detail?: string;        // 공지사항 등 세부 내용
  errorJson?: Record<string, unknown>;  // 에러 상세 JSON
  title?: string;              // 공지사항 제목
  author?: string;             // 작성자
  importance?: NoticeImportance; // 중요도
  attachmentName?: string;     // 첨부파일 이름
  attachmentUrl?: string;      // 첨부파일 URL
  attachmentSize?: number;     // 첨부파일 크기(bytes)
  noticeId?: number;           // notice 테이블 PK (수정 시 사용)
}

// 당일 날짜 문자열 (YYYY-MM-DD)
const _now = new Date();
const TODAY = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
const YESTERDAY = (() => {
  const d = new Date(_now);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

export const alertMockData: AlertMockData[] = [
  {
    id: 1,
    type: "Robot",
    status: "error",
    content: "Robot 1 로봇상태 장애 에러가 감지되었습니다.",
    date: `${TODAY} 09:22`,
    robotName: "Robot 1",
    isRead: false,
    errorJson: { code: "MOTOR_FAULT", module: "drive_unit", severity: "critical", detail: "Left wheel motor encoder signal lost" },
  },
  {
    id: 2,
    type: "Notice",
    status: "info",
    title: "관제시스템 v2.1.0 업데이트 안내",
    content: "관제시스템에서 알리는 시스템관련 전체 공지사항입니다.",
    detail: "관제시스템 v2.1.0 업데이트에 따라 다음 사항이 변경되었습니다.\n\n1. 로봇 모니터링 대시보드 UI 개선\n2. 알림 필터링 기능 추가\n3. 실시간 로그 조회 성능 최적화\n\n자세한 내용은 관리자에게 문의 바랍니다.",
    date: `${YESTERDAY} 13:08`,
    robotName: undefined,
    isRead: true,
    author: "관리자",
    importance: "normal",
  },
  {
    id: 3,
    type: "Schedule",
    status: "info",
    content: "방역 일정 공지 - 1동, 2동, 5동, 외곽 전체 방역 예정",
    date: `${YESTERDAY} 09:36`,
    robotName: undefined,
    isRead: true,
  },
  {
    id: 5,
    type: "Robot",
    status: "event",
    content: "Robot 1 상태 이상 없음, Robot 2 B구역 순찰 진행 중",
    date: `${YESTERDAY} 09:36`,
    robotName: "Robot 1, Robot 2",
    isRead: true,
  },
  {
    id: 6,
    type: "Robot",
    status: "error",
    content: "Robot 3 배터리 잔량 10% 이하로 감소하였습니다.",
    date: `${TODAY} 08:41`,
    robotName: "Robot 3",
    isRead: false,
    errorJson: { code: "BATTERY_LOW", level: 8, threshold: 10, estimatedMinutes: 12 },
  },
  {
    id: 7,
    type: "Robot",
    status: "event",
    content: "Robot 4 엘리베이터 연동 대기 상태입니다.",
    date: `${TODAY} 10:05`,
    robotName: "Robot 4",
    isRead: false,
  },
  {
    id: 8,
    type: "Notice",
    status: "info",
    title: "관제시스템 정기 점검 안내",
    content: "금일 18시 관제시스템 정기 점검이 예정되어 있습니다.",
    detail: "정기 점검 일정 안내\n\n- 일시: 금일 18:00 ~ 20:00 (약 2시간)\n- 대상: 관제시스템 전체 서버 및 네트워크\n- 영향: 점검 중 시스템 접속 불가\n\n점검 완료 후 별도 공지 예정입니다.",
    date: `${TODAY} 11:30`,
    robotName: undefined,
    isRead: false,
    author: "시스템관리자",
    importance: "high",
  },
  {
    id: 9,
    type: "Schedule",
    status: "info",
    content: "로봇 정기 점검 일정 등록 완료",
    date: `${YESTERDAY} 14:00`,
    robotName: undefined,
    isRead: true,
  },
  {
    id: 11,
    type: "Robot",
    status: "event",
    content: "Robot 6 A구역 순찰 임무를 시작했습니다.",
    date: `${TODAY} 13:20`,
    robotName: "Robot 6",
    isRead: true,
  },
  {
    id: 12,
    type: "Notice",
    status: "info",
    title: "로봇 펌웨어 v3.4.2 배포 안내",
    content: "신규 로봇 소프트웨어 업데이트가 배포되었습니다.",
    detail: "로봇 펌웨어 v3.4.2 배포 안내\n\n- 주행 알고리즘 안정성 개선\n- 배터리 소모율 최적화 (약 15% 절감)\n- 장애물 감지 센서 보정 업데이트\n\n업데이트는 충전 스테이션 도킹 시 자동 적용됩니다.",
    date: `${YESTERDAY} 16:45`,
    robotName: undefined,
    isRead: true,
    author: "개발팀",
    importance: "normal",
  },
  {
    id: 13,
    type: "Schedule",
    status: "info",
    content: "B구역 야간 점검 로봇 운영 스케줄",
    date: `${YESTERDAY} 20:00`,
    robotName: undefined,
    isRead: true,
  },
  {
    id: 14,
    type: "Robot",
    status: "error",
    content: "Robot 2 주행 중 장애물 감지로 일시 정지",
    date: `${TODAY} 14:02`,
    robotName: "Robot 2",
    isRead: false,
    errorJson: { code: "OBSTACLE_STOP", sensor: "lidar_front", distance: 0.15, location: "B_corridor_2" },
  },
  {
    id: 16,
    type: "Notice",
    status: "info",
    title: "전체 네트워크 점검 완료 안내",
    content: "전체 네트워크 점검 완료 안내",
    detail: "네트워크 점검 결과 보고\n\n- 1층~5층 AP 교체 완료\n- 로봇 전용 VLAN 대역폭 확장 (100Mbps → 1Gbps)\n- 통신 지연 평균 12ms → 3ms 개선\n\n이상 징후 발견 시 즉시 관리자에게 연락 바랍니다.",
    date: `${YESTERDAY} 09:10`,
    robotName: undefined,
    isRead: true,
    author: "인프라팀",
    importance: "normal",
  },
  {
    id: 17,
    type: "Robot",
    status: "event",
    content: "Robot 8 충전 스테이션 도킹 완료",
    date: `${TODAY} 15:05`,
    robotName: "Robot 8",
    isRead: true,
  },
  {
    id: 18,
    type: "Schedule",
    status: "info",
    content: "로봇 순찰 서비스 주말 운영 스케줄",
    date: `${TODAY} 09:00`,
    robotName: undefined,
    isRead: true,
  },
  {
    id: 19,
    type: "Robot",
    status: "error",
    content: "Robot 5 카메라 스트림 연결 실패",
    date: `${TODAY} 15:42`,
    robotName: "Robot 5",
    isRead: false,
    errorJson: { code: "CAM_STREAM_FAIL", device: "cam_front", protocol: "rtsp", errorMsg: "Connection refused" },
  },
  {
    id: 20,
    type: "Notice",
    status: "info",
    title: "관제 UI 개선 사항 적용",
    content: "관제 UI 개선 사항이 적용되었습니다.",
    detail: "관제 UI 개선 내역\n\n- 알림 관리 페이지 레이아웃 개편\n- 페이지네이션 도입 및 검색 필터 개선\n- 알림 상태 유형 세분화 (ERROR / INFO / EVENT)\n\n추가 개선 사항은 차기 업데이트에 반영 예정입니다.",
    date: `${TODAY} 16:10`,
    robotName: undefined,
    isRead: false,
    author: "개발팀",
    importance: "normal",
  },
  {
    id: 21,
    type: "Notice",
    status: "info",
    title: "2026년 1분기 관제시스템 종합 운영 보고서",
    content: "2026년 1분기 관제시스템 종합 운영 보고서",
    author: "관리자",
    importance: "high",
    attachmentName: "2026_Q1_운영보고서.pdf",
    detail: "2026년 1분기 관제시스템 종합 운영 보고서\n\n[ 1. 시스템 운영 현황 ]\n- 총 가동일: 90일 (1월 1일 ~ 3월 31일)\n- 시스템 가동률: 99.7%\n- 비계획 정지 시간: 총 6.5시간 (3건)\n- 계획 정비 시간: 총 12시간 (4건)\n\n[ 2. 로봇 운영 통계 ]\n- 총 운영 로봇 수: 12대\n- 총 임무 수행 건수: 14,328건\n- 임무 성공률: 97.2%\n- 평균 임무 소요 시간: 18.4분\n- 배터리 교체 횟수: 총 156회\n- 긴급 정지 발생: 23건\n\n[ 3. 장애 발생 내역 ]\n- 통신 장애: 12건 (Wi-Fi 불안정 7건, 서버 연결 실패 5건)\n- 센서 이상: 8건 (LiDAR 3건, 카메라 2건, 초음파 3건)\n- 구동부 장애: 5건 (모터 인코더 2건, 바퀴 슬립 3건)\n- 소프트웨어 오류: 3건 (경로 계획 실패 2건, 맵 동기화 1건)\n\n[ 4. 네트워크 인프라 ]\n- AP 교체: 총 8대 (A동 3대, B동 3대, C동 2대)\n- 평균 통신 지연: 4.2ms (목표 5ms 이내 달성)\n- 로봇 전용 VLAN 트래픽: 일 평균 2.3GB\n\n[ 5. 2분기 계획 ]\n- 신규 로봇 3대 추가 배치 (4월 중)\n- 실내 측위 시스템 UWB 전환 (5월 예정)\n- 관제 대시보드 v3.0 업데이트 (6월 예정)\n- 야간 자율 순찰 기능 시범 운영 (4월~)\n- 장애 자동 복구 시스템 도입 검토\n\n[ 6. 특이 사항 ]\n- 2월 15일 전체 네트워크 장애로 인해 약 3시간 시스템 중단 발생\n  → 원인: 코어 스위치 펌웨어 버그\n  → 조치: 펌웨어 롤백 후 안정화, 3월 패치 적용 완료\n- 3월 8일 Robot 3 구동부 이상으로 긴급 수리 (부품 교체 완료)\n\n자세한 내용은 관리자에게 문의 바랍니다.",
    date: `${TODAY} 07:00`,
    robotName: undefined,
    isRead: false,
  },
];
