# P1 Improvements Planning Document

> **Summary**: AI NEWS PORTAL UX/데이터 활용도 즉시 개선 (6개 항목)
>
> **Project**: AI NEWS PORTAL (ai-news-portal)
> **Version**: 1.0.0
> **Author**: haksujeon
> **Date**: 2026-02-15
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

현재 AI NEWS PORTAL이 `ai_news_ex` 테이블의 풍부한 데이터를 충분히 활용하지 못하고 있으며, 뉴스 목록의 시각적 구분과 사용성이 부족함. P1 개선을 통해 데이터 활용도와 UX 품질을 즉시 향상시킴.

### 1.2 Background

- `ai_news_ex` 테이블: 28건, CN(중국) 100%, 7개 카테고리, 3개 감성, 3개 출처
- 이미지 없는 뉴스 29% (8/28건) → 카드 높이 불균형
- 카테고리 7개가 모두 동일한 회색 배지로 표시 → 시각적 구분 없음
- 감성 분석이 `+`/`-`/`~` 한 글자로만 표시 → 의미 전달 부족
- 중복 뉴스(`is_duplicate`) 필터링 미적용
- 목록 쿼리에 불필요한 무거운 필드 포함 (ai_insights, key_terms 등)
- 날짜별 그룹핑 없어 뉴스 시간대 파악 어려움

### 1.3 Related Documents

- DB 분석: ai_news_ex 테이블 분석 결과 (세션 내 수행)
- 기존 코드: `/home/swingken/project/AiNews/src/`

---

## 2. Scope

### 2.1 In Scope

- [x] FR-01: 카테고리별 컬러/아이콘 매핑
- [x] FR-02: 감성 분석 시각화 강화
- [x] FR-03: 이미지 없는 뉴스 플레이스홀더
- [x] FR-04: 중복 뉴스 필터링
- [x] FR-05: 날짜별 그룹핑
- [x] FR-06: 목록 SELECT 최적화

### 2.2 Out of Scope

- embedding 기반 유사 뉴스 검색 (P3)
- 무한 스크롤/페이지네이션 (P3)
- 통계 대시보드 (P2)
- 원문 보기 토글 (P2)
- RSS 피드 생성 (P3)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 7개 카테고리(industry, policy, research, investment, product, culture, education)에 고유 색상/아이콘 매핑 | High | Pending |
| FR-02 | 감성 분석을 색상+라벨로 시각화 (긍정/부정/중립 → 한국어/영어/중국어 라벨) | High | Pending |
| FR-03 | 이미지 없는 뉴스에 카테고리별 그라데이션+아이콘 플레이스홀더 표시 | High | Pending |
| FR-04 | Supabase 쿼리에 `is_duplicate=is.false` 조건 추가 | Medium | Pending |
| FR-05 | 뉴스 목록을 날짜별 섹션 헤더로 그룹핑하여 표시 | Medium | Pending |
| FR-06 | 목록 조회 시 ai_insights, key_terms, description, author 필드 제거 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 목록 쿼리 응답 시간 개선 (불필요 필드 제거) | Supabase 응답 크기 비교 |
| UX | 카드 높이 균일화 (이미지 유/무 동일) | 시각적 확인 |
| 접근성 | 색상만으로 구분하지 않고 아이콘+텍스트 병용 | 시각적 확인 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 6개 FR 전체 구현 완료
- [ ] `next build` 성공
- [ ] 카드 뷰/리스트 뷰 모두에서 카테고리 색상 표시 확인
- [ ] 이미지 없는 뉴스 카드 높이 균일 확인
- [ ] 상세 페이지에서 감성 라벨 정상 표시 확인

### 4.2 Quality Criteria

- [ ] Zero TypeScript 에러
- [ ] Build 성공
- [ ] 3개 언어(ko/en/zh) 모두 라벨 정상 표시

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 카테고리 추가 시 색상맵 수동 업데이트 필요 | Low | Medium | 기본 fallback 색상 설정 |
| is_duplicate 필터로 노출 뉴스 수 감소 | Low | Low | 현재 0건이므로 영향 없음, 향후 모니터링 |
| 날짜 그룹핑이 단일 날짜 데이터에서 효과 미미 | Low | High | 다중 날짜 데이터 유입 시 자연스럽게 효과 발휘 |

---

## 6. Architecture Considerations

### 6.1 Project Level

| Level | Selected |
|-------|:--------:|
| **Dynamic** | ✅ |

### 6.2 Key Architectural Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| Framework | Next.js 16 + TypeScript | 기존 유지 |
| UI Components | shadcn/ui (Radix) | 기존 유지 |
| Styling | Tailwind CSS v4 | 기존 유지 |
| Data Source | Supabase REST API | 기존 유지 |
| i18n | next-intl | 기존 유지 |

### 6.3 수정 대상 파일

```
src/
├── lib/
│   ├── supabase.ts           ← FR-04, FR-06
│   └── news-utils.ts         ← FR-01, FR-02 (함수 추가)
├── components/news/
│   ├── news-card.tsx          ← FR-01, FR-02, FR-03
│   ├── news-list-item.tsx     ← FR-01, FR-02, FR-03
│   ├── news-detail.tsx        ← FR-01, FR-02
│   ├── news-container.tsx     ← FR-05
│   └── news-placeholder.tsx   ← FR-03 (신규)
└── messages/
    ├── ko.json                ← FR-02 (감성 라벨)
    ├── en.json                ← FR-02 (감성 라벨)
    └── zh.json                ← FR-02 (감성 라벨)
```

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] TypeScript configuration (`tsconfig.json`)
- [x] ESLint configuration (`eslint.config.mjs`)
- [x] Tailwind CSS (`globals.css`, `postcss.config.mjs`)
- [x] Path alias (`@/*` → `./src/*`)

### 7.2 Environment Variables

| Variable | Purpose | Scope | Status |
|----------|---------|-------|:------:|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL | Client | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 인증키 | Client | ✅ |

---

## 8. Implementation Order

| 순서 | FR | 파일 | 설명 |
|:----:|:--:|------|------|
| 1 | FR-06 | `supabase.ts` | 목록 SELECT 최적화 (가장 간단) |
| 2 | FR-04 | `supabase.ts` | 중복 뉴스 필터링 쿼리 추가 |
| 3 | FR-01 | `news-utils.ts` | 카테고리 컬러/아이콘 매핑 함수 |
| 4 | FR-02 | `news-utils.ts` + `messages/*.json` | 감성 라벨 함수 + i18n 메시지 |
| 5 | FR-03 | `news-placeholder.tsx` (신규) | 플레이스홀더 컴포넌트 생성 |
| 6 | FR-01,02,03 | `news-card.tsx`, `news-list-item.tsx`, `news-detail.tsx` | 카테고리/감성/플레이스홀더 적용 |
| 7 | FR-05 | `news-container.tsx` | 날짜별 그룹핑 로직 |

---

## 9. Next Steps

1. [ ] Design 문서 작성 (`/pdca design p1-improvements`)
2. [ ] 구현 진행 (`/pdca do p1-improvements`)
3. [ ] Gap 분석 (`/pdca analyze p1-improvements`)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-15 | Initial draft | haksujeon |
