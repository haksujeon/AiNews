/**
 * 공용 순위 함수(src/lib/news-rank.ts) 단위 테스트 — 실행: npm run test:unit
 *  - 브리핑 후보 선정 결과가 공용 함수로 옮긴 뒤에도 바이트 단위로 같다 (input_hash 가 바뀌면 판이 다시 생성된다)
 *  - 홈 "주요 4건": 전재가 두 칸을 차지하지 않음, 브리핑 인용 기사 우선, 개수 보존, 결정적
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateArticle } from "../../src/lib/briefing/types";
import { selectCandidates } from "../../src/lib/briefing/select";
import { citedRanksFromTopStories, rankStories, splitDay, type RankableArticle } from "../../src/lib/news-rank";

test("citedRanksFromTopStories: primary_ref·refs 에 순위, 잘못된 모양은 무시", () => {
  const m = citedRanksFromTopStories([
    { rank: 1, primary_ref: "a", refs: ["a", "b"] },
    { rank: 2, primary_ref: "c", refs: ["c", "b"] },
    null,
    { refs: "x" },
  ]);
  assert.equal(m.get("a"), 1);
  assert.equal(m.get("b"), 1);
  assert.equal(m.get("c"), 2);
  assert.equal(m.size, 3);
  assert.equal(citedRanksFromTopStories({ not: "array" }).size, 0);
});

const fixtures = join(__dirname, "..", "briefing", "fixtures");
const articles: CandidateArticle[] = JSON.parse(readFileSync(join(fixtures, "articles-2026-10-13.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(fixtures, "selection-2026-10-13.snapshot.json"), "utf8"));

function art(id: string, title_cn: string, source = "36Kr", extra: Partial<RankableArticle> = {}): RankableArticle {
  return { id, source_name: source, category: "ai-biz", title_cn, title_kr: id, summary_kr: "", ...extra };
}

// 2026-11-03: 인텔 별칭이 "인텔리전트"(톈쉬 인텔리전트)를 인텔로 잡던 오탐을 고쳐 다시 찍음 (그 기사의 인텔 가산 제거).
// 스냅숏은 2026-11-02 편집 QA 가중(매체 수 4·사건 단위 매체 수·해외 단일 매체 논문 감점·중국 주요 기업 큰 금액)으로 다시 찍었다.
// 2026-11-09: P2(옮겨 실은 매체 0.5)·P3(같은 사건 합치기, 묶음 65 → 59)·P5(거래 제목 금액·사건 제목·표기 사전 회사)·P1(중국 28 · 해외 12)로 다시 찍음.
// 점수 공식을 바꾸면 이 스냅숏도 의도적으로 다시 찍는다 (input_hash 가 바뀌어 판이 다시 생성된다).
test("브리핑 후보 선정: 스냅숏과 같다 (점수 공식이 바뀌면 의도적으로 갱신)", () => {
  const sel = selectCandidates(articles);
  const now = {
    totalGroups: sel.totalGroups,
    political: sel.politicalExcluded,
    groups: sel.groups.map((g) => ({
      shortId: g.shortId,
      primary: g.primary.id,
      siblings: g.siblings.map((x) => x.id),
      sources: g.sources,
      score: g.score,
      scoreDetail: g.scoreDetail,
    })),
  };
  assert.deepEqual(now, snapshot);
});

test("rankStories(cited 없음) 순서 = 브리핑 후보 순서 (같은 공식)", () => {
  const sel = selectCandidates(articles);
  const kept = articles.filter((a) => !sel.politicalExcluded.includes(a.id));
  const ranked = rankStories(kept).slice(0, sel.groups.length);
  assert.deepEqual(
    ranked.map((r) => r.primary.id),
    sel.groups.map((g) => g.primary.id)
  );
});

test("splitDay: 같은 title_cn 전재(36氪·虎嗅)는 주요 4칸 중 한 칸만, 매체 수 2", () => {
  const day = [
    art("a1", "梁文锋开始花钱了", "36Kr", { title_kr: "딥시크 량원펑 투자 100억 위안" }),
    art("a2", "梁文锋开始花钱了", "Huxiu", { title_kr: "딥시크 량원펑 투자 100억 위안" }),
    art("b", "某公司发布新品", "ITHome"),
    art("c", "另一条新闻标题内容", "Qbitai"),
    art("d", "第四条完全不同的报道", "Synced"),
    art("e", "第五条毫不相关的消息", "XinZhiYuan"),
  ];
  const { top, rest } = splitDay(day);
  assert.equal(top.length, 4);
  const topIds = top.map((t) => t.item.id);
  assert.ok(!(topIds.includes("a1") && topIds.includes("a2")), "전재 두 건이 모두 주요 4건에 들어감");
  // 전재 묶음은 매체 수 가산으로 1위, 대표는 매체 가중이 높은 36Kr
  assert.equal(top[0].item.id, "a1");
  assert.equal(top[0].outletCount, 2);
  // 형제(a2)는 나머지 맨 뒤 — 새 이야기가 먼저
  assert.equal(rest[rest.length - 1].item.id, "a2");
  // 개수 보존: 주요 + 나머지 = 그날 전체, 중복 없음
  const all = [...top, ...rest].map((x) => x.item.id);
  assert.equal(all.length, day.length);
  assert.equal(new Set(all).size, day.length);
});

test("splitDay: 발행된 브리핑의 주요 기사가 점수와 무관하게 먼저 (브리핑 순위대로)", () => {
  const day = [
    art("hi1", "高分新闻一 DeepSeek 发布", "Qbitai", { category: "ai-tech", title_kr: "딥시크 50% 향상" }),
    art("hi2", "高分新闻二 阿里 Qwen 发布", "Synced", { category: "ai-tech", title_kr: "알리바바 30억 달러" }),
    art("lo1", "天气晴朗适合出游", "Huxiu", { category: "economy" }),
    art("lo2", "股市今日小幅震荡", "Huxiu", { category: "economy" }),
    art("lo3", "城市地铁新线开通", "Huxiu", { category: "economy" }),
  ];
  const plain = splitDay(day).top.map((t) => t.item.id);
  // 두 고득점 기사 순서는 가중(중국 주요 기업 + 큰 금액 cn_deal)에 따라 바뀔 수 있다 — 둘이 먼저인 것만 본다
  assert.deepEqual([...plain.slice(0, 2)].sort(), ["hi1", "hi2"]);
  const cited = new Map([
    ["lo3", 1],
    ["lo1", 2],
  ]);
  const { top } = splitDay(day, { cited });
  assert.deepEqual(top.map((t) => t.item.id).slice(0, 2), ["lo3", "lo1"]);
  assert.deepEqual(top.map((t) => t.item.id).slice(2).sort(), ["hi1", "hi2"]);
});

test("splitDay: 인용 기사가 전재 형제여도 그 묶음 전체가 앞으로", () => {
  const day = [
    art("x1", "同一篇文章的标题", "36Kr", { category: "economy" }),
    art("x2", "同一篇文章的标题", "Huxiu", { category: "economy" }),
    art("y", "高分 DeepSeek 新闻 50%", "Qbitai", { category: "ai-tech" }),
  ];
  const { top } = splitDay(day, { cited: new Map([["x2", 1]]) });
  assert.equal(top[0].item.id, "x1"); // 대표는 pickPrimary 기준 (36Kr 가중 > Huxiu)
  assert.equal(top.length, 2);
});

test("splitDay: 4건 이하인 날은 나머지 없음, 결정적(입력 순서와 무관)", () => {
  const day = [art("p", "甲甲甲甲"), art("q", "乙乙乙乙"), art("r", "丙丙丙丙")];
  const a = splitDay(day);
  assert.equal(a.top.length, 3);
  assert.equal(a.rest.length, 0);
  const b = splitDay([...day].reverse());
  assert.deepEqual(a.top.map((t) => t.item.id), b.top.map((t) => t.item.id));
});

test("splitDay: fixture 70건 — 주요 4건은 서로 다른 묶음, 개수 보존", () => {
  const { top, rest } = splitDay(articles);
  assert.equal(top.length, 4);
  assert.equal(new Set(top.map((t) => t.item.title_cn)).size, 4);
  assert.equal(top.length + rest.length, articles.length);
});
