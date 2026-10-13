/**
 * 후보 선정(전재 묶기·정치 제외·점수·물량 규칙) 단위 테스트 — 실행: npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateArticle } from "../../src/lib/briefing/types";
import {
  bigrams,
  computeInputHash,
  dedupeReposts,
  editionModeFor,
  isPolitical,
  jaccard,
  selectCandidates,
} from "../../src/lib/briefing/select";

type FixtureArticle = CandidateArticle & { short_id: string };
const articles: FixtureArticle[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "articles-2026-10-13.json"), "utf8")
);
const byShort = (s: string) => articles.find((a) => a.short_id === s)!;

function art(id: string, title_cn: string, source = "36Kr"): CandidateArticle {
  return { id, source_name: source, source_url: null, category: "ai-biz", title_cn, title_kr: id, summary_kr: "", ai_insights_kr: "", key_terms: [] };
}

test("바이그램 Jaccard: 같은 제목 1.0, 무관한 제목 낮음", () => {
  assert.equal(jaccard(bigrams("梁文锋开始花钱了"), bigrams("梁文锋开始花钱了")), 1);
  assert.ok(jaccard(bigrams("梁文锋开始花钱了"), bigrams("IDC：英伟达在华数据中心 AI 芯片份额降至 34%")) < 0.1);
});

test("전재 묶기: 같은 title_cn·문장부호만 다른 제목은 묶고, 다른 글은 따로", () => {
  const groups = dedupeReposts([
    art("a", "梁文锋开始花钱了", "36Kr"),
    art("b", "梁文锋开始花钱了！", "Huxiu"),
    art("c", "IDC：英伟达在华数据中心 AI 芯片份额降至 34%", "ITHome"),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find((g) => g.length === 2)!.map((a) => a.id).sort(), ["a", "b"]);
});

test("fixture(10/13 70건): 같은 title_cn 전재 3쌍을 모두 묶는다", () => {
  const sameTitlePairs = new Map<string, number>();
  for (const a of articles) sameTitlePairs.set(a.title_cn, (sameTitlePairs.get(a.title_cn) ?? 0) + 1);
  const dupTitles = [...sameTitlePairs.values()].filter((n) => n > 1).length;
  assert.equal(dupTitles, 3);
  const groups = dedupeReposts(articles);
  for (const [title, n] of sameTitlePairs) {
    if (n < 2) continue;
    const holding = groups.filter((g) => g.some((a) => a.title_cn === title));
    assert.equal(holding.length, 1, `같은 제목이 여러 묶음에 흩어짐: ${title}`);
    assert.equal(holding[0].filter((a) => a.title_cn === title).length, n);
  }
  assert.ok(groups.length <= 67);
});

test("정치 기사(다카이치, ai-biz 로 잘못 분류) 제외, AI 기업 기사는 유지", () => {
  assert.equal(isPolitical(byShort("A11")), true);
  assert.equal(isPolitical(byShort("A36")), false);
  const sel = selectCandidates(articles);
  assert.ok(sel.politicalExcluded.includes(byShort("A11").id));
  assert.ok(!sel.groups.some((g) => g.primary.id === byShort("A11").id));
});

test("상위 40개, A01 부터 점수 내림차순, 전재 묶음은 매체 수만큼 가산", () => {
  const sel = selectCandidates(articles);
  assert.equal(sel.groups.length, 40);
  assert.equal(sel.groups[0].shortId, "A01");
  assert.equal(sel.groups[39].shortId, "A40");
  for (let i = 1; i < sel.groups.length; i++) assert.ok(sel.groups[i - 1].score >= sel.groups[i].score);
  const multi = sel.groups.find((g) => g.sources.length > 1);
  assert.ok(multi, "전재 묶음이 상위 40 안에 있어야 함");
  assert.equal(multi!.scoreDetail.coverage, 3 * Math.log2(1 + multi!.sources.length));
});

test("물량 규칙: ≥6 정상, 3~5 짧은 판, <3 생략", () => {
  assert.equal(editionModeFor(6), "normal");
  assert.equal(editionModeFor(5), "short");
  assert.equal(editionModeFor(3), "short");
  assert.equal(editionModeFor(2), "skipped");
});

test("입력 해시: 같은 입력은 같고, 본문·프롬프트 버전이 바뀌면 달라진다", () => {
  const sel = selectCandidates(articles);
  const h1 = computeInputHash(sel.groups, "v1", "m");
  assert.equal(h1, computeInputHash(selectCandidates(articles).groups, "v1", "m"));
  assert.notEqual(h1, computeInputHash(sel.groups, "v2", "m"));
  const changed = structuredClone(sel.groups);
  changed[0].primary.summary_kr += " (수정)";
  assert.notEqual(h1, computeInputHash(changed, "v1", "m"));
});
