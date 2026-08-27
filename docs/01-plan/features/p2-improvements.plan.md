# P2 Improvements Planning Document

> **Summary**: AI NEWS PORTAL 통계 대시보드 + 원문 보기 토글 (2개 기능)
>
> **Project**: AI NEWS PORTAL (ai-news-portal)
> **Version**: 1.0.0
> **Author**: haksujeon
> **Date**: 2026-02-15
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

P1 개선 완료 후 후속 개선으로, 뉴스 데이터의 분석적 활용(통계 대시보드)과 번역 품질 검증(원문 보기 토글)을 제공하여 사용자 가치를 높임.

### 1.2 Background

- P1 완료: 카테고리 컬러, 감성 시각화, 플레이스홀더, 중복 필터, 날짜 그룹핑, 쿼리 최적화
- 현재 데이터: `ai_news_ex` 테이블 28건, 7개 카테고리, 3개 감성, 4개 국가
- 통계 기능 부재: 카테고리 분포, 감성 트렌드, 국가별 현황 등 데이터 인사이트 제공 없음
- 번역 검증 불가: AI 번역 결과만 표시되며, 원본 제목과 비교할 수 없음

### 1.3 Related Documents

- P1 Plan: `docs/01-plan/features/p1-improvements.plan.md`
- DB 분석: ai_news_ex 테이블 (28건, CN 100%, 7개 카테고리)

---

## 2. Scope

### 2.1 In Scope

- [ ] FR-01: 통계 대시보드 페이지 (/statistics)
- [ ] FR-02: 카테고리 분포 차트 (도넛/파이)
- [ ] FR-03: 감성 분석 통계 (도넛 + 수치)
- [ ] FR-04: 국가별 뉴스 비율 (가로 바 차트)
- [ ] FR-05: 일별 뉴스 볼륨 (영역 차트)
- [ ] FR-06: 통계 KPI 카드 (총 뉴스 수, 오늘 뉴스, 카테고리 수, 국가 수)
- [ ] FR-07: 뉴스 상세 페이지 원문 보기 토글

### 2.2 Out of Scope

- 실시간 통계 업데이트 (현재 5분 revalidate 유지)
- 기간 필터 (날짜 범위 선택)
- 통계 데이터 내보내기 (CSV/PDF)
- 원문 본문 크롤링/표시 (source_url 링크만 제공)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | `/[locale]/statistics` 페이지 신규 생성, 헤더에 네비게이션 링크 추가 | High | Pending |
| FR-02 | 7개 카테고리 분포를 도넛 차트로 시각화, 기존 카테고리 색상 활용 | High | Pending |
| FR-03 | 감성(positive/negative/neutral) 비율을 도넛 차트 + 수치로 표시 | High | Pending |
| FR-04 | 국가별 뉴스 비율을 가로 바 차트로 표시 | Medium | Pending |
| FR-05 | 최근 30일 일별 뉴스 등록 수를 영역 차트로 표시 | Medium | Pending |
| FR-06 | 총 뉴스 수, 오늘 뉴스, 카테고리 수, 국가 수를 KPI 카드로 표시 | High | Pending |
| FR-07 | 상세 페이지에서 AI 번역 ↔ 원문 제목 토글, 원문 제목 표시 영역 강화 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement |
|----------|----------|-------------|
| Performance | 통계 페이지 초기 로드 < 2초 | 개발자 도구 Network |
| UX | 차트 반응형 (모바일~데스크탑) | 시각적 확인 |
| 접근성 | 차트에 호버 툴팁 + 범례 텍스트 병용 | 시각적 확인 |
| 번들 크기 | Recharts tree-shaking 적용, 사용 컴포넌트만 import | Build 분석 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 7개 FR 전체 구현 완료
- [ ] `next build` 성공
- [ ] 통계 페이지 4개 차트 정상 렌더링
- [ ] KPI 카드 수치 정확성 확인
- [ ] 상세 페이지 원문 토글 정상 동작
- [ ] 3개 언어(ko/en/zh) 통계 라벨 정상 표시

### 4.2 Quality Criteria

- [ ] Zero TypeScript 에러
- [ ] Build 성공
- [ ] 반응형 레이아웃 확인 (모바일/태블릿/데스크탑)

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Recharts 번들 크기 증가 | Medium | High | Tree-shaking, 필요 컴포넌트만 import |
| 데이터 28건으로 차트가 빈약 | Low | High | 빈 상태 메시지 + 데이터 증가 시 자연스럽게 개선 |
| original_title이 null인 경우 | Low | Medium | 원문 토글 비활성화 처리 |

---

## 6. Architecture Considerations

### 6.1 Project Level

| Level | Selected |
|-------|:--------:|
| **Dynamic** | ✅ |

### 6.2 Key Architectural Decisions

| Decision | Selected | Rationale |
|----------|----------|-----------|
| Chart Library | Recharts | React 친화적, tree-shaking 지원, 커뮤니티 활발 |
| 통계 계산 위치 | Server Component | 데이터 28건으로 서버에서 계산 후 전달이 효율적 |
| 원문 토글 | Client State (`useState`) | 간단한 UI 토글, 추가 API 호출 불필요 |
| 통계 데이터 | 기존 `fetchNewsList()` 활용 | 별도 API 불필요, 100건 이하 데이터 |

### 6.3 파일 구조

```
src/
├── app/[locale]/
│   └── statistics/
│       └── page.tsx                    ← FR-01 (신규)
├── components/
│   ├── statistics/
│   │   ├── statistics-container.tsx    ← FR-01 (신규, 클라이언트)
│   │   ├── stat-cards.tsx             ← FR-06 (신규)
│   │   ├── category-chart.tsx         ← FR-02 (신규)
│   │   ├── sentiment-chart.tsx        ← FR-03 (신규)
│   │   ├── country-chart.tsx          ← FR-04 (신규)
│   │   └── daily-volume-chart.tsx     ← FR-05 (신규)
│   ├── news/
│   │   └── news-detail.tsx            ← FR-07 (수정)
│   └── layout/
│       └── header.tsx                 ← FR-01 (수정, 네비 링크 추가)
├── lib/
│   └── statistics-utils.ts            ← FR-02~06 (신규, 통계 계산 함수)
└── messages/
    ├── ko.json                        ← 통계/토글 번역 추가
    ├── en.json                        ← 통계/토글 번역 추가
    └── zh.json                        ← 통계/토글 번역 추가
```

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] TypeScript strict mode
- [x] shadcn/ui + Tailwind CSS v4
- [x] next-intl i18n (ko/en/zh)
- [x] Server Components by default, `"use client"` only when needed

### 7.2 New Dependencies

| Package | Purpose | Size Impact |
|---------|---------|-------------|
| `recharts` | 차트 라이브러리 | ~150KB (tree-shaken) |

### 7.3 Environment Variables

기존 변수 그대로 사용 (추가 없음)

---

## 8. Implementation Order

| 순서 | FR | 파일 | 설명 |
|:----:|:--:|------|------|
| 1 | - | `package.json` | `recharts` 설치 |
| 2 | FR-06 | `statistics-utils.ts` | 통계 계산 유틸리티 함수 |
| 3 | FR-06 | `stat-cards.tsx` | KPI 카드 컴포넌트 |
| 4 | FR-02 | `category-chart.tsx` | 카테고리 분포 도넛 차트 |
| 5 | FR-03 | `sentiment-chart.tsx` | 감성 분석 도넛 차트 |
| 6 | FR-04 | `country-chart.tsx` | 국가별 가로 바 차트 |
| 7 | FR-05 | `daily-volume-chart.tsx` | 일별 볼륨 영역 차트 |
| 8 | FR-01 | `statistics-container.tsx` | 통계 컨테이너 (차트 조합) |
| 9 | FR-01 | `statistics/page.tsx` | 통계 페이지 라우트 |
| 10 | FR-01 | `header.tsx` | 네비게이션에 통계 링크 추가 |
| 11 | FR-07 | `news-detail.tsx` | 원문 보기 토글 추가 |
| 12 | - | `messages/*.json` | 번역 키 추가 (statistics, toggle) |

---

## 9. UI Specification

### 9.1 Statistics Dashboard Layout

```
┌─────────────────────────────────────────────┐
│ Header (+ Statistics 네비 링크)               │
├─────────────────────────────────────────────┤
│ Statistics Dashboard                    (h1) │
│                                              │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│ │ 총뉴스│ │ 오늘 │ │카테고리│ │ 국가 │  KPI  │
│ │  28  │ │   5  │ │   7  │ │   4  │ Cards  │
│ └──────┘ └──────┘ └──────┘ └──────┘        │
│                                              │
│ ┌──────────────────┐ ┌──────────────────┐   │
│ │ Category Dist.   │ │ Sentiment        │   │
│ │   (Donut Chart)  │ │   (Donut Chart)  │   │
│ └──────────────────┘ └──────────────────┘   │
│                                              │
│ ┌──────────────────┐ ┌──────────────────┐   │
│ │ Country          │ │ Daily Volume     │   │
│ │  (Bar Chart)     │ │  (Area Chart)    │   │
│ └──────────────────┘ └──────────────────┘   │
├─────────────────────────────────────────────┤
│ Footer                                       │
└─────────────────────────────────────────────┘
```

### 9.2 Original Toggle (Detail Page)

```
┌─────────────────────────────────────────────┐
│ [AI 번역] [원문]  ← 토글 버튼 (제목 위)      │
│                                              │
│ AI 번역 제목 (기존)                           │
│ ─── 또는 ───                                  │
│ 원문 제목 (original_title)                    │
│                                              │
│ ... 본문 (번역된 content 유지) ...             │
│                                              │
│ 원문 보기 → source_url 링크 (기존 유지)        │
└─────────────────────────────────────────────┘
```

---

## 10. Translation Keys

### 10.1 Statistics (신규 네임스페이스)

```json
{
  "statistics": {
    "title": "통계 대시보드 / Statistics Dashboard / 统计仪表板",
    "totalNews": "총 뉴스 / Total News / 新闻总数",
    "todayNews": "오늘 뉴스 / Today / 今日新闻",
    "categories": "카테고리 / Categories / 分类数",
    "countries": "국가 / Countries / 国家数",
    "categoryDistribution": "카테고리 분포 / Category Distribution / 分类分布",
    "sentimentAnalysis": "감성 분석 / Sentiment Analysis / 情感分析",
    "countryBreakdown": "국가별 현황 / Country Breakdown / 各国分布",
    "dailyVolume": "일별 뉴스량 / Daily News Volume / 每日新闻量",
    "articles": "건 / articles / 篇"
  }
}
```

### 10.2 Detail Toggle (기존 detail 네임스페이스 확장)

```json
{
  "detail": {
    "aiTranslation": "AI 번역 / AI Translation / AI翻译",
    "originalTitle": "원문 제목 / Original Title / 原文标题"
  }
}
```

---

## 11. Next Steps

1. [ ] Design 문서 작성 (`/pdca design p2-improvements`)
2. [ ] Recharts 설치 + 구현 진행 (`/pdca do p2-improvements`)
3. [ ] Gap 분석 (`/pdca analyze p2-improvements`)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-15 | Initial draft | haksujeon |
