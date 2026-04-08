"""
서버 시작 시 FFmpeg 가용 여부를 확인하고,
없으면 자동으로 다운로드 + PATH 등록하는 유틸.
"""
import os
import platform
import shutil
import subprocess
import sys
import zipfile
import urllib.request

# FFmpeg 바이너리를 저장할 로컬 디렉토리
FFMPEG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ffmpeg_bin")

# Windows용 FFmpeg 릴리스 (gyan.dev — essentials 빌드, ~80MB)
FFMPEG_WIN_URL = "https://github.com/GyanD/codexffmpeg/releases/download/8.1/ffmpeg-8.1-essentials_build.zip"
FFMPEG_WIN_INNER = "ffmpeg-8.1-essentials_build"  # ZIP 내부 폴더명


def is_ffmpeg_available() -> bool:
    """FFmpeg가 PATH에 있거나 로컬 ffmpeg_bin에 있는지 확인"""
    return shutil.which("ffmpeg") is not None


_ensured = False  # 프로세스 내 1회만 실행


def ensure_ffmpeg() -> bool:
    """FFmpeg가 없으면 자동 다운로드 + PATH 등록. 성공 여부 반환."""
    global _ensured
    if _ensured:
        return True

    if is_ffmpeg_available():
        _ensured = True
        return True

    # 로컬 ffmpeg_bin에 이미 다운로드돼 있는지 확인
    local_ffmpeg = _find_local_ffmpeg()
    if local_ffmpeg:
        _add_to_path(os.path.dirname(local_ffmpeg))
        print(f"[FFMPEG] 로컬 바이너리 PATH 등록: {local_ffmpeg}")
        _ensured = True
        return True

    # 자동 다운로드 시도
    if platform.system() != "Windows":
        print("[FFMPEG] Windows가 아닌 환경 — 수동 설치 필요 (apt install ffmpeg / brew install ffmpeg)")
        return False

    print("[FFMPEG] FFmpeg 미설치 — 자동 다운로드 시작...")
    try:
        return _download_ffmpeg_windows()
    except Exception as e:
        print(f"[FFMPEG] 자동 다운로드 실패: {e}")
        print("[FFMPEG] 수동 설치 방법: winget install Gyan.FFmpeg")
        return False


def _find_local_ffmpeg():
    """ffmpeg_bin 디렉토리에서 ffmpeg 바이너리 찾기"""
    if not os.path.exists(FFMPEG_DIR):
        return None

    exe_name = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"

    for root, dirs, files in os.walk(FFMPEG_DIR):
        if exe_name in files:
            return os.path.join(root, exe_name)
    return None


def _add_to_path(bin_dir: str):
    """현재 프로세스의 PATH에 디렉토리 추가"""
    current_path = os.environ.get("PATH", "")
    if bin_dir not in current_path:
        os.environ["PATH"] = bin_dir + os.pathsep + current_path


def _download_ffmpeg_windows() -> bool:
    """Windows용 FFmpeg ZIP을 다운로드 → 압축 해제 → PATH 등록"""
    os.makedirs(FFMPEG_DIR, exist_ok=True)
    zip_path = os.path.join(FFMPEG_DIR, "ffmpeg.zip")

    # 다운로드
    print(f"[FFMPEG] 다운로드 중: {FFMPEG_WIN_URL}")
    urllib.request.urlretrieve(FFMPEG_WIN_URL, zip_path)
    print(f"[FFMPEG] 다운로드 완료 ({os.path.getsize(zip_path) // (1024*1024)}MB)")

    # 압축 해제
    print("[FFMPEG] 압축 해제 중...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(FFMPEG_DIR)

    # ZIP 삭제
    os.remove(zip_path)

    # bin 디렉토리 찾기
    bin_dir = os.path.join(FFMPEG_DIR, FFMPEG_WIN_INNER, "bin")
    ffmpeg_exe = os.path.join(bin_dir, "ffmpeg.exe")

    if not os.path.exists(ffmpeg_exe):
        print(f"[FFMPEG] ffmpeg.exe를 찾을 수 없습니다: {bin_dir}")
        return False

    # PATH 등록
    _add_to_path(bin_dir)

    # 확인
    result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
    version_line = result.stdout.split("\n")[0] if result.stdout else "unknown"
    print(f"[FFMPEG] 설치 완료: {version_line}")
    return True
