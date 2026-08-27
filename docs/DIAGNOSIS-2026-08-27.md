# AI News 포털 점검 보고 (2026-08-27)

## 1. 서비스 다운 (최우선)
- nginx `news.aibaseclub.com` → `127.0.0.1:3012` 프록시.
- 점검 시점에 **3012 포트에 아무 프로세스도 없었음** (PM2 등록 없음, systemd 유닛 없음) → 사이트 502.
- `package.json`의 `start`는 `next start -p 3002`인데 3002는 mindmap PM2 클러스터가 점유 중 → 포트 설정 불일치.
- 임시 조치: `npx next dev -p 3012` 수동 기동(세션 종료 시 사라짐). 영구 조치 필요.
- `.next/BUILD_ID` 생성일 2026-06-17 → `npm run build` 재실행 후 `next start` 권장.

## 2. 클라이언트 fetch가 basePath(`/ainews`) 누락
`next.config.ts`에 `basePath: "/ainews"` 설정. Next는 `<Link>`/`router`/`next/image`만 자동 prefix, 순수 `fetch()`는 미적용.
검증(운영 도메인):
- `GET /api/news?offset=30&limit=30` → **404**
- `GET /ainews/api/news?offset=30&limit=30` → 200

영향받는 호출부 (전부 `/api/...`로 하드코딩):
- `src/lib/supabase-client.ts:7,15,27` → 무한스크롤 30건 이후 중단, 상세 모달 빈 화면, 관련뉴스 없음
- `src/app/[locale]/admin/login/page.tsx:25` → 관리자 로그인 실패
- `src/components/admin/admin-shell.tsx:87`, `subscribers-container.tsx:92,117,118,144,154`, `send-history-container.tsx:40` → 관리자 기능 전부 실패

## 3. 통계 페이지 500 (상시)
`src/lib/statistics-utils.ts` 가 `news_date`를 `YYYY-MM-DD`로 가정하나, API/`supabase.ts`의 `to_char(...)`는 `2026-05-09T00:00:00Z` 형태를 반환.
- `calculateWeeklyTrend:153` → `new Date("2026-05-09T00:00:00Z" + "T00:00:00")` = Invalid Date → `toISOString()` RangeError → 페이지 500
- `calculateDailyVolume:108` → 차트 x축 라벨이 전체 ISO 문자열
- `calculateKPIs:172` → `todayStr`(YYYY-MM-DD) 비교 불일치 → 오늘 건수 항상 0
→ `calculateDailyVolume` 경계에서 `date.slice(0,10)`으로 정규화하는 것이 정석.

## 4. 데이터 3.5개월 정체
- DB `ai_news_ex`: 5,093건, 최신 `news_date` = **2026-05-09** (오늘 2026-08-27).
- 원인: n8n 워크플로 `중국 AI 뉴스 수집 - Daily [aibaseclub v2]` (id `xOkFhLu8pRaN8LRl`, 1일 3회 00/05/14시) **매 실행 전부 error**.
- 실패 노드: `Polish Translation` (HTTP → LiteLLM `127.0.0.1:4100`)
  - `400 Invalid model name passed in model=aliyun-tp-deepseek-v4-pro`
  - LiteLLM `/v1/models` 37개 목록에 해당 모델 없음. 대체 후보: `apiyi-deepseek-v4-flash`, `apiyi-deepseek-v3-2`, `glm-4.6`
- 이 노드 하류의 `Save to DB`가 skip → 수집·번역은 되지만 저장이 0건.

## 정상 확인된 부분
- `/ainews/ko`, `/ainews/en` SSR 200, 30건 렌더링 + 날짜별 그룹핑 정상
- `/ainews/api/news`, `/ainews/api/news/[id]`, `/ainews/api/news/related?exclude=...&category=...` 200
- 상세 페이지 `/ainews/ko/news/[id]` 200, 본문/관련뉴스 서버 렌더 정상
- 썸네일 커버리지 100건 중 87건, title_kr/en/news_date NULL 0건

---

# 조치 결과 (2026-08-27 실행)

## ① 서비스 상주화 — 완료
- `package.json`: `dev`/`start` 포트 `3002` → **`3012`** (nginx 프록시 대상과 일치, mindmap 충돌 해소)
- `ecosystem.config.js` 신규 — PM2 앱 `ainews` 정의 (fork, 3012, autorestart)
- `npm run build` 성공 → `pm2 start ecosystem.config.js && pm2 save`
- 현재 상태: `ainews` online, restarts 0
- **남은 조치(sudo 필요)**: `pm2 startup` 미설정 → 서버 재부팅 시 자동 복구 안 됨

## ② basePath fetch — 완료
- `next.config.ts`: `BASE_PATH` 상수화 + `env.NEXT_PUBLIC_BASE_PATH` 노출
- `src/lib/api-path.ts` 신규 — `apiUrl(path)` 헬퍼
- 호출부 11곳 전부 `apiUrl()` 경유로 교체:
  - `src/lib/supabase-client.ts` (3)
  - `src/app/[locale]/admin/login/page.tsx` (1)
  - `src/components/admin/admin-shell.tsx` (1)
  - `src/components/admin/send-history-container.tsx` (1)
  - `src/components/admin/subscribers-container.tsx` (5)
- 브라우저 검증(Playwright, 운영 도메인):
  - 카드 30 → **180** (무한스크롤 정상, offset 30/60/90/120/150 전부 200)
  - 상세 모달 822자 렌더 정상
  - 4xx/5xx API 호출 **0건**

## ③ n8n 모델명 — 완료
- 백업: `docs/n8n-backup-xOkFhLu8pRaN8LRl-20260827.json`
- `aliyun-tp-deepseek-v4-pro` → `apiyi-deepseek-v4-flash`, **4개 노드** 일괄 교체
  (Polish Translation, AI Agent - Translation, AI Agent - Insights, OpenRouter Chat Model 2)
- 중요: `AI Agent - Translation` / `AI Agent - Insights` 는 `onError=continueRegularOutput` 이라
  400을 먹고도 "성공"으로 표시되며 **중국어 원문을 그대로 통과**시키고 있었다.
  실행로그의 `title_kr = title_cn` 이 그 증거. 즉 번역 자체도 계속 실패 중이었음.
- 실패했던 노드의 동일 페이로드를 새 모델로 재현 → **200 + 정상 한국어 출력** 확인
- 전체 파이프라인 검증은 다음 스케줄 실행(**14:00 UTC**) 이후 DB 건수로 확인 필요

## ④ 통계 날짜 정규화 — 완료
- `src/lib/statistics-utils.ts`에 `toDateKey()` 경계 함수 추가
- `calculateDailyVolume`, `calculateKPIs` 가 이를 경유 → 차트 라벨/오늘 건수 정상화
- `calculateWeeklyTrend`: Invalid Date 가드 + **`toISOString()` 제거**
  (로컬 자정 파싱 후 UTC 변환 시 KST에서 주 키가 하루 밀리는 잠재 버그 동시 수정)
- `/ainews/ko/statistics` 500 → **200**, 날짜 키 `2026-05-09` 형태로 정상 출력

## 검증 명령
```
pm2 list                       # ainews online 확인
npx tsc --noEmit               # 타입 에러 0
npm run build && pm2 reload ainews   # 재배포
```

## 후속 점검 예약
- `scripts/check-ingest.mjs` 신규 — DB 건수/최신일자 + **번역 여부(title_kr != title_cn)** + n8n 최근 실행 + 사이트/pm2 헬스체크
  - 번역 여부를 함께 보는 이유: onError=continueRegularOutput 때문에 "건수 증가"만으로는 정상 판정 불가
- 세션 cron 예약: 2026-08-27 14:23 UTC 1회 (job c82f1559) — **세션 종료 시 소멸**
- 세션과 무관하게 돌리려면 시스템 crontab 등록:
  `23 14 * * * cd /home/swingken/project/AiNews && /usr/bin/node scripts/check-ingest.mjs >> /tmp/ainews-check.log 2>&1`

## 외부 접속
- https://news.aibaseclub.com  (루트 → `/ainews/ko` 302)
- nginx `sites-enabled/news.aibaseclub.com` → `127.0.0.1:3012`
- TLS 인증서는 `mind.aibaseclub.com` 것을 공유 (Certbot)
