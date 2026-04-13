import os
import shutil
import subprocess
import threading
import time
from datetime import datetime
from typing import Optional, Callable


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


class CameraRecordingWorker:
    """카메라당 1개씩 실행되는 녹화 워커 (데몬 스레드)"""

    def __init__(
        self,
        rtsp_url: str,
        output_dir: str,
        robot_id: int,
        module_id: int,
        record_type: str,
        segment_duration: int = 300,
        on_segment_complete: Optional[Callable] = None,
        on_error: Optional[Callable] = None,
    ):
        self.rtsp_url = rtsp_url
        self.output_dir = output_dir
        self.robot_id = robot_id
        self.module_id = module_id
        self.record_type = record_type
        self.segment_duration = segment_duration
        self.on_segment_complete = on_segment_complete
        self.on_error = on_error

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._process: Optional[subprocess.Popen] = None
        self._current_segment: int = 0
        self.error_reason: Optional[str] = None  # 실패 사유
        self.file_prefix: Optional[str] = None   # 이 세션의 파일명 접두사

    def start(self):
        os.makedirs(self.output_dir, exist_ok=True)
        self._thread = threading.Thread(target=self._run, daemon=True, name=f"rec-{self.robot_id}-{self.module_id}")
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._process:
            try:
                self._process.terminate()
                self._process.wait(timeout=5)
            except Exception:
                try:
                    self._process.kill()
                except Exception:
                    pass
        if self._thread:
            self._thread.join(timeout=10)

    @property
    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self):
        if _ffmpeg_available():
            print(f"[REC] FFmpeg 모드 시작: robot={self.robot_id}, cam={self.module_id}, url={self.rtsp_url}")
            self._run_ffmpeg()
        else:
            print(f"[REC] cv2 fallback 모드: robot={self.robot_id}, cam={self.module_id} (FFmpeg 미설치)")
            self._run_cv2()

    def _run_ffmpeg(self):
        """FFmpeg subprocess로 RTSP 녹화 (MPEGTS 세그먼트 → 종료 시 MP4 변환)"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.file_prefix = f"{self.robot_id}_cam{self.module_id}_{self.record_type}_{timestamp}"
        # MPEGTS 세그먼트로 녹화 (강제 종료에도 파일 손상 없음)
        pattern = os.path.join(
            self.output_dir,
            f"{self.file_prefix}_seg%03d.ts",
        )

        cmd = [
            "ffmpeg",
            # RTSP 연결: TCP 전송 + 안정성 플래그
            "-rtsp_transport", "tcp",
            "-rtsp_flags", "prefer_tcp",
            "-i", self.rtsp_url,
            "-c", "copy",
            "-f", "segment",
            "-segment_time", str(self.segment_duration),
            "-segment_format", "mpegts",
            "-reset_timestamps", "1",
            "-y",
            pattern,
        ]

        retry_count = 0
        max_retries = 5

        while not self._stop_event.is_set() and retry_count <= max_retries:
            try:
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )

                # FFmpeg 실행 중 대기 — stop 신호 체크
                while not self._stop_event.is_set():
                    retcode = self._process.poll()
                    if retcode is not None:
                        # FFmpeg가 자체 종료 (스트림 끊김 등)
                        break
                    self._stop_event.wait(timeout=1)

                if self._stop_event.is_set():
                    # 정상 종료 요청
                    self._process.terminate()
                    self._process.wait(timeout=5)
                    break

                # FFmpeg가 비정상 종료 → stderr에서 원인 추출
                stderr_out = ""
                try:
                    stderr_out = self._process.stderr.read().decode(errors="replace")[-500:]
                except Exception:
                    pass

                retry_count += 1
                if retry_count <= max_retries:
                    wait_sec = min(3 * retry_count, 15)  # 3s, 6s, 9s, 12s, 15s
                    print(f"[REC] RTSP 끊김 감지 (robot={self.robot_id}, cam={self.module_id}), "
                          f"{retry_count}/{max_retries} 재연결 시도 ({wait_sec}초 후)...")
                    self._stop_event.wait(timeout=wait_sec)
                else:
                    self.error_reason = f"RTSP 연결 실패 ({max_retries}회 재시도 초과)"
                    if "Connection refused" in stderr_out:
                        self.error_reason = "RTSP 서버 연결 거부 (카메라 꺼짐 또는 포트 오류)"
                    elif "No route to host" in stderr_out or "Network is unreachable" in stderr_out:
                        self.error_reason = "네트워크 도달 불가 (로봇 IP 확인 필요)"
                    elif "401" in stderr_out or "Unauthorized" in stderr_out:
                        self.error_reason = "RTSP 인증 실패"
                    elif "timed out" in stderr_out.lower():
                        self.error_reason = "RTSP 연결 시간 초과"
                    print(f"[REC] FFmpeg 최종 실패: {self.error_reason}")

            except Exception as e:
                print(f"[REC] FFmpeg 오류: {e}")
                retry_count += 1
                self.error_reason = f"FFmpeg 실행 오류: {str(e)[:100]}"
                if retry_count <= max_retries:
                    self._stop_event.wait(timeout=5)

        # 완료 후 세그먼트 파일 처리
        self._finalize_segments()

        if retry_count > max_retries and self.on_error:
            self.on_error(self.robot_id, self.module_id)

    def _run_cv2(self):
        """cv2 fallback — 영상만 녹화 (음성 불가)"""
        try:
            import cv2
        except ImportError:
            self.error_reason = "FFmpeg, OpenCV 모두 미설치 — 녹화 불가"
            print(f"[REC] {self.error_reason}")
            if self.on_error:
                self.on_error(self.robot_id, self.module_id)
            return

        retry_count = 0
        max_retries = 5
        seg_idx = 0

        while not self._stop_event.is_set() and retry_count <= max_retries:
            cap = cv2.VideoCapture(self.rtsp_url)
            if not cap.isOpened():
                retry_count += 1
                if retry_count <= max_retries:
                    wait_sec = min(3 * retry_count, 15)
                    print(f"[REC] cv2 RTSP 연결 실패, {retry_count}/{max_retries} 재시도 ({wait_sec}초 후)...")
                    self._stop_event.wait(timeout=wait_sec)
                else:
                    self.error_reason = f"cv2 RTSP 연결 실패 ({max_retries}회 재시도 초과): {self.rtsp_url}"
                    print(f"[REC] {self.error_reason}")
                continue

            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
            retry_count = 0  # 연결 성공 시 리셋

            while not self._stop_event.is_set():
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"{self.robot_id}_cam{self.module_id}_{self.record_type}_{timestamp}_seg{seg_idx:03d}.mp4"
                filepath = os.path.join(self.output_dir, filename)

                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(filepath, fourcc, fps, (w, h))

                seg_start = time.time()
                frames_written = 0

                while not self._stop_event.is_set():
                    ret, frame = cap.read()
                    if not ret:
                        # 스트림 끊김
                        break
                    writer.write(frame)
                    frames_written += 1

                    if time.time() - seg_start >= self.segment_duration:
                        break

                writer.release()

                if frames_written == 0:
                    # 빈 파일 삭제
                    try:
                        os.remove(filepath)
                    except Exception:
                        pass

                # 프레임 읽기 실패 (스트림 끊김)
                if not self._stop_event.is_set() and not ret:
                    break

                seg_idx += 1
                self._generate_thumbnail_for_file(filepath)

            cap.release()

            if not self._stop_event.is_set():
                retry_count += 1
                if retry_count <= max_retries:
                    wait_sec = min(3 * retry_count, 15)
                    print(f"[REC] cv2 스트림 끊김, {retry_count}/{max_retries} 재연결 ({wait_sec}초 후)...")
                    self._stop_event.wait(timeout=wait_sec)

        self._finalize_segments()

        if retry_count > max_retries and self.on_error:
            self.on_error(self.robot_id, self.module_id)

    def _finalize_segments(self):
        """녹화 완료 후: TS → MP4 변환 + 썸네일 생성"""
        if not os.path.exists(self.output_dir):
            return

        for fname in sorted(os.listdir(self.output_dir)):
            if not fname.endswith(".ts"):
                continue
            ts_path = os.path.join(self.output_dir, fname)
            size = os.path.getsize(ts_path) if os.path.exists(ts_path) else 0
            if size == 0:
                continue

            # TS → MP4 변환 (코덱 복사, 빠름)
            mp4_path = ts_path.rsplit(".", 1)[0] + ".mp4"
            try:
                subprocess.run(
                    ["ffmpeg", "-i", ts_path, "-c", "copy", "-y", mp4_path],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=30,
                )
            except Exception as e:
                print(f"[REC] TS→MP4 변환 실패: {e}")
                continue

            if os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 0:
                # 변환 성공 → TS 원본 삭제
                try:
                    os.remove(ts_path)
                except Exception:
                    pass

                mp4_size = os.path.getsize(mp4_path)
                thumb = self._generate_thumbnail_for_file(mp4_path)

                if self.on_segment_complete:
                    self.on_segment_complete(
                        filepath=mp4_path,
                        thumbnail_path=thumb,
                        video_size=mp4_size,
                    )

    def _generate_thumbnail_for_file(self, video_path: str) -> Optional[str]:
        return generate_thumbnail(video_path)


def generate_thumbnail(video_path: str) -> Optional[str]:
    """영상에서 첫 프레임을 JPEG 썸네일로 추출 (모듈 레벨 함수)"""
    thumb_path = video_path.rsplit(".", 1)[0] + "_thumb.jpg"

    if _ffmpeg_available():
        try:
            subprocess.run(
                [
                    "ffmpeg", "-i", video_path,
                    "-ss", "0", "-frames:v", "1",
                    "-y", thumb_path,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
            if os.path.exists(thumb_path):
                return thumb_path
        except Exception:
            pass
    else:
        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            ret, frame = cap.read()
            cap.release()
            if ret:
                cv2.imwrite(thumb_path, frame)
                return thumb_path
        except Exception:
            pass

    return None
