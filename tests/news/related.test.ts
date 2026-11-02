import { test } from "node:test";
import assert from "node:assert/strict";
import { RELATED_MIN_JACCARD, rankRelated, type RelatedCandidate } from "../../src/lib/related";

const a = (id: string, p: Partial<RelatedCandidate>): RelatedCandidate => ({
  id,
  source_name: "Qbitai",
  category: "ai-tech",
  title_cn: "",
  title_kr: "",
  summary_kr: "",
  day: "2026-10-30",
  ...p,
});

const seed = a("seed", {
  title_cn: "深度求索发布新模型V4，推理成本下降",
  title_kr: "딥시크, 새 모델 V4 공개… 추론 비용 하락",
  summary_kr: "딥시크가 엔비디아 GPU 없이 학습한 V4 를 공개했다.",
});

test("공유 실체가 많은 후보가 먼저 (제목 유사도·같은 분류보다 우선)", () => {
  const out = rankRelated(seed, [
    a("cat-only", { title_cn: "某公司发布财报", title_kr: "어느 회사 실적 발표" }),
    a("one-ent", { category: "ai-biz", title_cn: "英伟达股价上涨", title_kr: "엔비디아 주가 상승" }),
    a("two-ent", { category: "ai-biz", title_cn: "深度求索与英伟达合作", title_kr: "딥시크·엔비디아 협력" }),
  ]);
  assert.deepEqual(out.map((r) => r.item.id), ["two-ent", "one-ent"]);
  assert.deepEqual(out[0].sharedEntities, ["deepseek", "nvidia"]);
  // 실체도 제목 유사도도 없는 후보는 같은 분류라도 내지 않는다
  assert.ok(!out.some((r) => r.item.id === "cat-only"));
});

test("실체 수가 같으면 제목 바이그램 Jaccard → 같은 분류 → 최신 → id 순", () => {
  const out = rankRelated(seed, [
    // 셋 다 실체(딥시크) 1개, 기준 제목과 바이그램 0 — 서로 다른 글
    a("old-same", { title_kr: "딥시크 채용", title_cn: "招聘工程师", day: "2026-10-01" }),
    a("new-other", { title_kr: "딥시크 행사", title_cn: "举办开发者大会", day: "2026-10-29", category: "ai-biz" }),
    a("new-same", { title_kr: "딥시크 홈페이지", title_cn: "更新官网", day: "2026-10-29" }),
    a("similar", { title_kr: "딥시크 V4", title_cn: "深度求索发布新模型V5", day: "2026-09-30" }),
  ]);
  assert.deepEqual(out.map((r) => r.item.id), ["similar", "new-same", "old-same", "new-other"]);
});

test("실체가 없어도 제목이 비슷하면(Jaccard ≥ 하한) 후보", () => {
  const s2 = a("s2", { title_cn: "具身智能机器人量产计划公布", title_kr: "구현형 로봇 양산 계획" });
  const out = rankRelated(s2, [
    a("near", { title_cn: "具身智能机器人量产时间表", title_kr: "로봇 양산 일정" }),
    a("far", { title_cn: "芯片出口管制新规", title_kr: "칩 수출 통제" }),
  ]);
  assert.deepEqual(out.map((r) => r.item.id), ["near"]);
  assert.ok(out[0].jaccard >= RELATED_MIN_JACCARD);
});

test("전재(같은 글)는 0건: 기준 기사의 전재는 모두 빼고, 후보끼리 같은 글은 하나만", () => {
  const out = rankRelated(seed, [
    // 기준 기사와 title_cn 이 같다 → 다른 매체 전재
    a("repost-same", { source_name: "36Kr", title_cn: "深度求索发布新模型V4，推理成本下降", title_kr: "딥시크 V4 공개" }),
    // 바이그램 Jaccard ≥ 0.6 → 전재
    a("repost-near", { source_name: "Huxiu", title_cn: "深度求索发布新模型V4，推理成本大幅下降", title_kr: "딥시크 V4" }),
    // 후보 둘이 서로 같은 글 → 순위가 높은 쪽(엔비디아까지 공유)만
    a("pair-a", { title_cn: "深度求索获英伟达芯片订单", title_kr: "딥시크, 엔비디아 칩 주문" }),
    a("pair-b", { source_name: "36Kr", title_cn: "深度求索获英伟达芯片订单", title_kr: "딥시크 칩 주문" }),
    a("other", { title_cn: "深度求索招聘", title_kr: "딥시크 채용" }),
  ]);
  const ids = out.map((r) => r.item.id);
  assert.ok(!ids.includes("repost-same") && !ids.includes("repost-near"), ids.join(","));
  assert.equal(ids.filter((x) => x === "pair-a" || x === "pair-b").length, 1);
  assert.deepEqual(ids, ["pair-a", "other"]);
});

test("기준 기사 자신은 후보에서 빠지고 limit 을 지킨다", () => {
  const many = Array.from({ length: 10 }, (_, i) => a(`c${i}`, { title_kr: `딥시크 소식 ${i}`, title_cn: `深度求索 ${i}号消息` }));
  const out = rankRelated(seed, [seed, ...many], 4);
  assert.equal(out.length, 4);
  assert.ok(!out.some((r) => r.item.id === "seed"));
});
