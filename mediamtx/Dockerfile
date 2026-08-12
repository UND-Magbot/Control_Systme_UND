# MediaMTX (Tier 2: 무재인코딩 직접 중계)
# - mediamtx.yml 전제상 ffmpeg 불필요(로봇 H.264 RTSP를 그대로 WebRTC로 중계).
# - mediamtx 바이너리는 statically linked ELF(x86-64)라 별도 런타임 의존성이 없어
#   가벼운 alpine 베이스로 충분하다.
FROM alpine:3.20

# 정적 링크 바이너리 + 런타임 설정
COPY mediamtx /usr/local/bin/mediamtx
COPY mediamtx.yml /mediamtx.yml

RUN chmod +x /usr/local/bin/mediamtx

# api 9997 / rtsp 8554(tcp) / webrtc 8889 / webrtc ICE 8189(tcp+udp)
EXPOSE 9997
EXPOSE 8554
EXPOSE 8889
EXPOSE 8189
EXPOSE 8189/udp

ENTRYPOINT ["/usr/local/bin/mediamtx"]
CMD ["/mediamtx.yml"]
