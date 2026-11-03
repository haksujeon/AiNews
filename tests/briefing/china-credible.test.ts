/**
 * 결정 D3 (2026-11-03): 믿을 만한 중국 후보가 모자란 날은 중국 중심 규칙을 있는 만큼만 요구한다.
 * 모자란 할당을 채우려고 근거 없는 중국 항목을 지어내던 문제(10-28 v5 「바이두 OCR」) 회귀.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BriefingContent, CandidateArticle, CandidateGroup } from "../../src/lib/briefing/types";
import {
  CHINA_SHORT_NOTE,
  chinaCentricCount,
  chinaCentricRequired,
  chinaCredibleCount,
  contextFromGroups,
  normalizeContent,
  validateKo,
} from "../../src/lib/briefing/validate";

const FIX = join(__dirname, "fixtures");
type FixtureArticle = CandidateArticle & { short_id: string };
const articles: FixtureArticle[] = JSON.parse(readFileSync(join(FIX, "articles-2026-10-13.json"), "utf8"));
const sample = JSON.parse(readFileSync(join(FIX, "sample-ko-2026-10-13.json"), "utf8")).briefing;
const groupsOf = (arts: FixtureArticle[]): CandidateGroup[] =>
  arts.map((a) => ({ shortId: a.short_id, primary: a, siblings: [], sources: [a.source_name], score: 0, scoreDetail: {} }));
const load = (): BriefingContent => normalizeContent(structuredClone(sample)).content;

test("chinaCentricRequired: 믿을 만한 후보 수가 없으면 예전처럼 3, 있으면 min(3, 후보)", () => {
  assert.equal(chinaCentricRequired("normal", 5), 3);
  assert.equal(chinaCentricRequired("normal", 5, 1), 1);
  assert.equal(chinaCentricRequired("normal", 5, 7), 3);
  assert.equal(chinaCentricRequired("short", 3, 0), 0);
});

test("chinaCredibleCount: 상위 15위 안이거나 2개 이상 매체가 다룬 중국 후보만 센다", () => {
  const cn = (id: string, i: number): CandidateGroup => ({
    shortId: id, primary: { ...articles[0], id, short_id: id, title_kr: `중국 후보 ${i}`, title_cn: `中国候选${i}`, subject_region: "CN" } as FixtureArticle,
    siblings: [], sources: ["a"], score: 0, scoreDetail: {},
  });
  const us = (id: string): CandidateGroup => ({ ...cn(id, 0), primary: { ...articles[0], id, title_kr: `미국 ${id}`, title_cn: `美国${id}`, subject_region: "US" } as FixtureArticle });
  // 상위 15 = 미국 14 + 중국 1, 16위 이후 중국 3건(한 매체) + 중국 1건(두 매체)
  const groups = [...Array.from({ length: 14 }, (_, i) => us(`U${i}`)), cn("C0", 0), cn("C1", 1), cn("C2", 2), cn("C3", 3), { ...cn("C4", 4), sources: ["a", "b"] }];
  assert.equal(chinaCredibleCount(groups, new Map(groups.map((g) => [g.shortId, g.shortId]))), 2);
});

test("믿을 만한 중국 후보가 모자란 날: 있는 만큼 쓰면 치명이 아니라 경고 + lede 안내 문장", () => {
  const ctx = contextFromGroups(groupsOf(articles), "normal");
  const full = validateKo(load(), ctx).report;
  assert.ok(full.fatal.some((f) => f.rule === "china_centric"), "후보가 충분하면 예전처럼 치명");
  const china = full.stats.chinaCentric;
  const c = load();
  c.lede = "짧은 리드.";
  const r = validateKo(c, { ...ctx, chinaCredible: china });
  assert.ok(!r.report.fatal.some((f) => f.rule === "china_centric"), JSON.stringify(r.report.fatal.filter((f) => f.rule === "china_centric")));
  assert.ok(r.report.warn.some((w) => w.rule === "china_short"));
  assert.ok(r.content.lede.endsWith(CHINA_SHORT_NOTE));
  // 다시 검증해도 안내 문장을 두 번 붙이지 않는다
  const again = validateKo(r.content, { ...ctx, chinaCredible: china });
  assert.equal(again.content.lede.split(CHINA_SHORT_NOTE).length - 1, 1);
});

test("믿을 만한 후보가 있는데 안 쓰면 여전히 치명", () => {
  const ctx = contextFromGroups(groupsOf(articles), "normal");
  const china = validateKo(load(), ctx).report.stats.chinaCentric;
  const r = validateKo(load(), { ...ctx, chinaCredible: china + 1 });
  assert.ok(r.report.fatal.some((f) => f.rule === "china_centric"));
});

test("중국 할당을 채운 날 모델이 쓴 '해외 소식 비중' 문장은 지운다", () => {
  const ctx = contextFromGroups(groupsOf(articles), "normal");
  const base = load();
  // 중국 주체 기사만 남긴 판 → 상위 N건이 모두 중국 주체 = 할당 충족 (target = min(3, N))
  const cnOnly = base.top_stories.filter((s) => chinaCentricCount({ ...base, top_stories: [s] }, ctx) === 1);
  assert.ok(cnOnly.length >= 1);
  const c = { ...load(), top_stories: cnOnly.map((s, i) => ({ ...s, rank: i + 1 })) };
  c.lede = "첫 문장이다. 오늘은 해외 소식의 비중이 크다.";
  const r = validateKo(c, ctx);
  assert.equal(r.report.stats.chinaCentric, cnOnly.length);
  assert.equal(r.content.lede, "첫 문장이다.");
  assert.ok(r.report.warn.some((w) => w.rule === "china_short_note"));
});
