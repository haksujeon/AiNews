/** 히스토리 분석 자동 생성 — 검색어 만들기·검사·번역 검사·실행 흐름 (story-gen.ts, story-run.ts) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLensPlans, checkStory, checkTranslated, escapeRegex, pickedFrom, toKoRow, type Candidate } from "../../src/lib/briefing/story-gen";
import { ensureStoryContext, type StoryRunDeps } from "../../src/lib/briefing/story-run";

const cand = (i: number, d: string, title = `기사 ${i}`): Candidate => ({ id: `id${i}`, d, s: "36Kr", title_kr: title, summary_kr: "매출 30억 위안", title_cn: "标题", summary_cn: null, title_en: "Title" });

test("검색어: 정규식 문자는 이스케이프, 넓은 낱말은 빼고, 이름표 회사면 별칭을 보탠다", () => {
  assert.equal(escapeRegex("a.b(c)|d"), "a\\.b\\(c\\)\\|d");
  const plans = buildLensPlans(
    { company: { name: "딥시크", terms: ["딥시크"] }, topic: { name: "에이전트 경쟁", terms: ["에이전트", "智能体", "AI", "모델", "x"] } },
    { title: "t", subject: "DeepSeek" }
  );
  const company = plans.find((p) => p.lens === "company")!;
  assert.match("深度求索 발표", new RegExp(company.pattern));
  const topic = plans.find((p) => p.lens === "topic")!;
  assert.equal(topic.pattern, "에이전트|智能体");
  assert.equal(topic.exclude, company.pattern);
  assert.equal(topic.topicName, "에이전트 경쟁");
  // 주제 낱말이 2개 미만이면 주제 관점 없음, 회사 null 이고 이름표에도 없으면 회사 관점 없음
  assert.deepEqual(buildLensPlans({ company: null, topic: { terms: ["로봇"] } }, { title: "t", subject: "정부" }), []);
});

test("고르기: 없는 번호는 버리고 오래된 순", () => {
  const pool = [cand(1, "2026-10-05"), cand(2, "2026-09-01"), cand(3, "2026-10-20")];
  const r = pickedFrom({ picked: ["C003", "C002", "C999"], thread_title: "줄기" }, pool);
  assert.deepEqual(r.picked.map((p) => p.id), ["id2", "id3"]);
  assert.equal(r.threadTitle, "줄기");
});

test("코드 검사: 날짜·근거·숫자·한자·항목 수", () => {
  const picked = [cand(1, "2026-09-01"), cand(2, "2026-10-05"), cand(3, "2026-10-20")];
  const good = { background: "배경", now: "지금", caution: "", timeline: [
    { date: "09-01", text: "매출 30억 위안", refs: ["P01"] }, { date: "10-05", text: "둘", refs: ["P02"] }, { date: "10-20", text: "셋", refs: ["P03"] }] };
  assert.deepEqual(checkStory(good, picked), []);
  const bad = { ...good, now: "深度", timeline: [{ date: "09-02", text: "매출 99억", refs: ["P01"] }, { date: "10-05", text: "둘", refs: ["P09"] }] };
  const p = checkStory(bad, picked).join(" / ");
  for (const w of ["항목 수 2", "날짜 09-02", "숫자 99", "없는 근거", "now 한자"]) assert.ok(p.includes(w), `${w} ← ${p}`);
  assert.ok(checkStory({ ...good, background: "오늘 기사는 흐름의 끝입니다." }, picked).includes("오늘·어제 표현"));
  const row = toKoRow("a1", "company", "줄기", good, picked);
  assert.equal(row.timeline[0].date, "2026-09-01");
  assert.equal(row.timeline[0].refs[0].title, "기사 1");
});

test("번역 검사: 숫자·한글 남음·모양이 다르면 그 항목만 뺀다", () => {
  const src = [{ thread_title: "줄기", background: "매출 30억 위안", timeline: ["하나"], now: "지금", caution: "" }, { thread_title: "둘", background: "b", timeline: ["x"], now: "n", caution: "" }];
  const r = checkTranslated(src, { items: [{ thread_title: "脉络", background: "营收30亿元", timeline: ["一"], now: "现在", caution: "" }, { thread_title: "二", background: "한글", timeline: ["x"], now: "n", caution: "" }] }, "zh");
  assert.deepEqual([...r.ok.keys()], [0]);
  assert.ok(r.issues.some((i) => i.includes("Korean")));
  const n = checkTranslated(src.slice(0, 1), { items: [{ thread_title: "脉络", background: "营收50亿元", timeline: ["一"], now: "现在", caution: "" }] }, "zh");
  assert.ok(n.issues.some((i) => i.includes("numbers")));
});

test("실행: 이미 있는 관점은 건너뛰고, LLM 오류가 있으면 기록하지 않는다", async () => {
  const recorded: string[] = [];
  const saved: string[] = [];
  const deps: StoryRunDeps = {
    loadPublished: async () => ({ id: "b1", date: "2026-11-03", content: { top_stories: [{ rank: 1, title: "t", subject: "딥시크", what: "w", refs: ["a1"], primary_ref: "a1" }] } as never }),
    hasRun: async () => false,
    existing: async () => new Set(["a1:company:ko", "a1:company:zh", "a1:company:en"]),
    todayArticles: async () => [],
    candidates: async () => [cand(1, "2026-09-01"), cand(2, "2026-10-05"), cand(3, "2026-10-20")],
    koRows: async () => [],
    titles: async () => new Map(),
    llm: async (c) => {
      if (c.system.startsWith("중국 AI 뉴스 기사 하나")) return { raw: { company: { terms: ["딥시크", "DeepSeek"] }, topic: { name: "주제", terms: ["에이전트", "智能体"] } }, costUsd: 0.01 };
      if (c.system.startsWith("오늘 기사(TODAY)")) return { raw: { picked: ["C001", "C002", "C003"], thread_title: "줄기" }, costUsd: 0.01 };
      throw new Error("시간 초과");
    },
    translateLlm: async () => null,
    save: async (rows) => (saved.push(...rows.map((r) => `${r.lens}:${r.locale}`)), rows.length),
    recordRun: async (id) => void recorded.push(id),
  };
  const r = await ensureStoryContext({}, deps);
  assert.equal(r.status, "error");
  assert.deepEqual(recorded, []);
  assert.deepEqual(saved, []);
  assert.ok(r.errors[0].includes("시간 초과"));
});
