# AI News 포털 — 추가 개선 필요사항 (2026-08-27 조사)

2026-08-27 장애 조치(서비스 상주화 / basePath / n8n 모델명 / 통계 날짜) 완료 후,
코드베이스·인프라 조사에서 확인된 잔여 항목. **아직 아무것도 수정하지 않음.**

---

## P0-1. `/api/news/upsert` 무인증 공개 쓰기 — 기존 기사 덮어쓰기 가능

`src/app/api/news/upsert/route.ts` 에 인증 코드가 전혀 없다.
`grep "requireAdminAuth\|Authorization\|API_KEY" src/app/api/news/upsert/route.ts` → 0건.

인터넷에서 실측 (데이터 오염 없이 빈 배열로 도달성만 확인):
```
POST https://news.aibaseclub.com/ainews/api/news/upsert
Content-Type: application/json
[]
→ 200 {"ok":true,"upserted":0}
```

심각도가 "스팸 삽입"에 그치지 않는 이유 — `id` 가 `ALLOWED_COLS` 에 포함되어 있고
쿼리가 `ON CONFLICT (id) DO UPDATE SET "col" = EXCLUDED."col"` 이다 (route.ts:25-37).
따라서 **임의의 제3자가 기존 기사의 UUID를 넣어 제목·요약·본문·원문링크를 통째로 바꿔치기**할 수 있다.
뉴스 포털에서 이는 콘텐츠 변조(defacement)에 해당한다.

부가: `catch` 가 DB 원문 에러 메시지를 그대로 응답에 실어 보낸다 (스키마 정보 노출).

**방향(택1)**: 공유 시크릿 헤더 검증 / `requireAdminAuth` 재사용 / nginx에서 해당 경로를 localhost 전용으로 제한.
현재 n8n은 `Save to DB` 노드로 Postgres에 직접 쓰므로, 이 API를 아예 막아도 파이프라인은 영향 없음 (확인 필요).

## P0-2. 버전관리 없음

`git rev-parse` → `fatal: not a git repository`. `.gitignore` 는 있으나 저장소가 없다.
오늘 9개 파일을 수정했지만 diff·되돌리기·이력이 전혀 없다. 지금 상태에서 실수는 복구 불가.
`git init` + 초기 커밋이 목록 중 **위험 제거 대비 노력 비율이 가장 높다** (2분).
주의: `.env.local` (DB 비밀번호, ADMIN_PASSWORD, ADMIN_SECRET) 이 커밋되지 않도록 `.gitignore` 확인 선행.

## P0-3. PM2 부팅 자동복구 미설정

`systemctl is-enabled pm2-swingken` → `not-found`.
현재 재부팅 시 `ainews`, `mindmap`, `anti-api` 전부 안 올라온다. sudo 필요.

## P0-4. 관리자 로그인 무제한 시도 + LiteLLM 키 평문

- `/api/admin/auth` 에 rate limiting 없음. 단일 공유 비밀번호 + 무제한 시도 = 무차별 대입 가능.
- `password !== process.env.ADMIN_PASSWORD` 는 상수시간 비교가 아님 (단일 비밀번호라 실익은 낮으나 함께 처리 권장).
- LiteLLM 키가 n8n 노드 헤더에 **평문**으로 박혀 있다. n8n Credential로 옮기고 **키 로테이션 권장**
  (해당 키는 워크플로 JSON·실행 로그·본 세션 출력에 노출된 이력이 있음).
  ※ 다른 워크플로가 같은 키를 공유할 수 있으므로 로테이션 영향 범위 확인 후 진행할 것.

## P0-5. `/api/news/check-exists` 무인증

POST 전용, 인증 없음. 읽기 전용이라 심각도는 낮으나, 저장된 `source_url` 목록을 외부에서 열거할 수 있다.
P0-1과 같은 방식으로 함께 막는 것이 합리적.

---

## P1-1. 검색·필터가 "이미 로드된 것"만 대상 — 결과가 조용히 불완전

`src/lib/news-utils.ts` 의 `filterNews()` 는 인자로 받은 배열만 필터링하고,
`news-container.tsx` 는 그 배열로 브라우저에 로드된 `allNews` 를 넘긴다.
`/api/news` 는 필터 파라미터가 **하나도 없다** (offset/limit 뿐).

결과: 전체 5,093건 중 사용자가 스크롤로 로드한 30~180건 안에서만 검색된다.
"OpenAI" 를 검색하면 대부분 0건이 나오는데 **부분 결과라는 표시가 없다.**
사용자에게는 "검색이 안 돼요"로 보이는 결함. 날짜 범위·카테고리 필터도 동일.

**방향**: `/api/news` 에 `q` / `category` / `country` / `from` / `to` 파라미터를 추가해 SQL에서 처리.

## P1-2. 통계 페이지가 1,000행 원본을 브라우저로 전송

`fetchNewsForStats()` 가 `STATS_FIELDS`(= LIST_FIELDS + key_terms, `summary_cn/kr/en` 3개 포함)를
1,000행 조회해 클라이언트 컴포넌트에 통째로 넘긴다. 결과 HTML **1,739,145 bytes (약 1.7MB)**.
집계는 전부 SQL로 가능한 작업이다.

## P1-3. 기사 페이지 SEO/공유 메타데이터 없음

- `generateMetadata` 없음 → 모든 기사 상세의 `<title>` 이 `AI NEWS PORTAL` 로 동일 (실측 확인).
- OG/Twitter 카드 없음 → 카톡·슬랙 공유 시 제목·썸네일이 안 뜬다.
- `sitemap.ts` / `robots.ts` 없음, canonical·hreflang 없음 → 검색 노출 불가.

뉴스 포털의 유입 경로가 검색·공유임을 감안하면 기능적으로 큰 손실.

---

## P2-1. n8n 번역 노드의 무음 실패

`AI Agent - Translation`, `AI Agent - Insights` 가 `onError=continueRegularOutput`.
LLM 호출이 400을 받아도 워크플로는 '성공'으로 표시되고 **중국어 원문이 그대로 저장**된다.
2026-08-27 장애에서 실제로 이 상태였다 (`title_kr = title_cn`).
검증 노드를 넣거나 onError 정책을 바꿔 실패가 드러나게 해야 한다.

## P2-2. 에러가 삼켜지고 모니터링이 없음

`/api/news` 등의 `catch { return NextResponse.json([], { status: 500 }) }` — 로깅 없음.
사이트 다운 + 수집 중단이 **3.5개월간 아무도 모른 채** 방치된 근본 원인.
최소한 `scripts/check-ingest.mjs` 를 시스템 crontab에 걸고 실패 시 알림(텔레그램 등) 연결 권장.

---

## 관찰됨 (수정 시급도 낮음)

- Next 16 `middleware` → `proxy` 컨벤션 deprecation 경고. 현재 동작에는 문제 없음.
- `supabase.ts` / `supabase-client.ts` / `supabase-admin.ts` 네이밍. 2026-06-16 내부 PostgreSQL로 이관 완료되어
  실제로는 `pg` 직접 연결인데 이름이 남아 있다 (10개 파일에서 참조). 오해 소지.
- `/api/news/related` 에 `exclude` 가 빈 문자열이면 uuid 캐스팅 실패로 500.
  현재 이렇게 호출하는 코드는 없음 (조사 중 잘못된 파라미터명으로 재현한 것).
