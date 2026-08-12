FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# MediaMTX(WebRTC/WHEP) 호스트를 빌드에 굽는다. NEXT_PUBLIC_* 는 빌드타임에 인라인되므로
# 여기서 주지 않으면 런타임에 바꿀 수 없다. 미지정이면 기존대로 접속 hostname 을 쓴다.
ARG NEXT_PUBLIC_MEDIAMTX_HOST
ENV NEXT_PUBLIC_MEDIAMTX_HOST=$NEXT_PUBLIC_MEDIAMTX_HOST
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3001
CMD ["nginx", "-g", "daemon off;"]
