/** 히스토리 분석 자동 생성 — 검색어 만들기·검사·번역 검사·실행 흐름 (story-gen.ts, story-run.ts) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLensPlans, buildStoryPlan, checkLensOverlap, limitActorPicks, checkStory, checkTranslated, escapeRegex, pickedFrom, rankTopics, scoreTopic, toKoRow, type Candidate, type StoryRow } from "../../src/lib/briefing/story-gen";
import { ensureStoryContext, type StoryRunDeps } from "../../src/lib/briefing/story-run";
import { PLAN_SYSTEM as PLAN_SYSTEM_ } from "../../src/lib/briefing/story-gen";

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
  // 회사 기사를 주제에서 일괄로 빼지 않는다 (story-v1.2)
  assert.equal("exclude" in topic, false);
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
    topicTitles: async () => [...Array(20)].map(() => ({ title_kr: "텐센트 바이두 화웨이 에이전트", title_cn: "" })),
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

// ───────── story-v1.2: 주제 고르기·겹침 검사 (11-04 애플 기사 사례)

test("주제 후보: 회사·제품 이름이 든 이름은 버리고, 낱말에서도 뺀다. 넓이(level)를 지킨다", () => {
  const p = buildStoryPlan(
    {
      company: { name: "알리바바", terms: ["알리바바", "阿里巴巴"] },
      actors: [{ name: "애플", terms: ["애플", "苹果", "애플 인텔리전스", "苹果智能"] }, { name: "알리바바", terms: ["치엔원", "千问"] }],
      topics: [
        { level: "event", name: "애플 인텔리전스 중국 출시", terms: ["애플 인텔리전스", "国行", "국행"] },
        { level: "industry", name: "해외 기업의 중국 현지 AI 파트너", terms: ["중국판", "中国版", "苹果智能", "本土化"] },
        { level: "market", name: "휴대폰 속 AI 비서 경쟁", terms: ["AI手机", "手机助手"] },
      ],
    },
    { title: "애플 중국판 AI 공개, 알리바바 치엔원 탑재", subject: "알리바바" }
  );
  assert.deepEqual(p.topics.map((t) => t.topicName), ["해외 기업의 중국 현지 AI 파트너", "휴대폰 속 AI 비서 경쟁"]);
  assert.equal(p.topics[0].pattern, "중국판|中国版|本土化"); // 苹果智能(제품 이름) 빠짐
  assert.equal(p.topics[0].level, "industry");
  assert.ok(new RegExp(p.actorPattern!).test("苹果 发布"));
  // 예전 모양(topic 하나)도 받는다
  assert.equal(buildStoryPlan({ company: null, topic: { name: "에이전트", terms: ["에이전트", "智能体"] } }, { title: "t", subject: "정부" }).topics.length, 1);
});

test("주제 점수: 이 기사 회사가 대부분인 후보(사건 수준)는 떨어지고, 산업 흐름이 먼저", () => {
  const actor = "애플|苹果|알리바바|阿里";
  const t = (k: string) => ({ title_kr: k, title_cn: "" });
  const eventLevel = [...Array(22)].map(() => t("애플 인텔리전스 중국 출시 임박")).concat([...Array(6)].map(() => t("바이두 화웨이 소식")));
  const industry = [...Array(10)].map(() => t("애플 중국판")).concat([...Array(45)].map((_, i) => t(i % 2 ? "바이트댄스 해외 진출" : "텐센트 화웨이 협력")));
  const s1 = scoreTopic(eventLevel, actor);
  assert.equal(s1.ok, false);
  assert.match(s1.why, /사건 수준/);
  const s2 = scoreTopic(industry, actor);
  assert.equal(s2.ok, true, s2.why);
  assert.equal(scoreTopic([t("x")], actor).ok, false); // 기사 적음
  const plan = (level: "event" | "industry" | "market") => ({ lens: "topic" as const, pattern: "x", topicName: level, level });
  const ranked = rankTopics([
    { plan: plan("market"), score: { ...s2 } },
    { plan: plan("event"), score: s1 },
    { plan: plan("industry"), score: { ...s2 } },
  ]);
  assert.deepEqual(ranked.map((c) => c.plan.level), ["industry", "market"]);
});

const row = (title: string, items: [string, string, string][]): Pick<StoryRow, "thread_title" | "timeline"> => ({
  thread_title: title,
  timeline: items.map(([date, text, id]) => ({ date, text, refs: [{ id, source: "36Kr", title: text }] })),
});

test("겹침 검사: 11-04 애플 기사처럼 같은 사건을 다른 매체로 다시 쓴 주제 흐름은 걸린다", () => {
  const company = row("애플 인텔리전스 중국 출시와 알리바바 치엔원 협력", [
    ["2026-07-16", "애플 인텔리전스가 중국 당국의 생성형 AI 서비스 등록 심사를 통과했고 알리바바가 참여합니다.", "a1"],
    ["2026-10-15", "팀 쿡은 애플 인텔리전스와 치엔원이 승인받았다며 10월 말 테스트 출시를 밝혔습니다.", "a2"],
    ["2026-10-15", "블룸버그는 애플이 12월 iOS 27.3 업데이트로 첫 기능을 선보일 계획이라고 보도했습니다.", "a3"],
  ]);
  const topicSame = row("애플 인텔리전스 중국 출시와 알리바바 제휴", [
    ["2026-07-15", "중국 당국이 공개한 생성형 AI 서비스 등록 목록에 애플 인텔리전스가 포함됐습니다.", "b1"],
    ["2026-10-15", "팀 쿡 최고경영자는 애플 중국판이 승인을 받았다며 10월 말 베타 출시를 예고했습니다.", "b2"],
    ["2026-10-15", "블룸버그는 애플 정식 출시가 12월 iOS 27.3과 함께 이뤄진다고 보도했습니다.", "b3"],
  ]);
  const actor = "애플|苹果|알리바바|阿里|치엔원";
  const p = checkLensOverlap(company, topicSame, actor).join(" / ");
  for (const w of ["제목이 비슷함", "같은 사건", "이 기사 회사 사건 3개"]) assert.ok(p.includes(w), `${w} ← ${p}`);
  // 회사 사례가 1개 섞인 넓은 주제는 통과 (회사 기사를 일괄로 빼지 않는다)
  const topicWide = row("해외 기업이 중국 AI 파트너를 찾는 흐름", [
    ["2026-05-02", "삼성은 중국판 갤럭시에 바이두 모델을 넣는다고 밝혔습니다.", "c1"],
    ["2026-07-15", "중국 당국이 공개한 생성형 AI 서비스 등록 목록에 애플 인텔리전스가 포함됐습니다.", "c2"],
    ["2026-08-20", "BMW는 중국 차량에 딥시크 모델을 연동한다고 발표했습니다.", "c3"],
    ["2026-09-30", "퀄컴은 중국 휴대폰 제조사와 현지 모델 최적화에 협력한다고 했습니다.", "c4"],
  ]);
  assert.deepEqual(checkLensOverlap(company, topicWide, actor), []);
});

test("실행: 주제 흐름이 회사 흐름과 겹치면 다음 후보로, 다 겹치면 주제는 내지 않는다", async () => {
  const saved: string[] = [];
  const synthTopics: string[] = [];
  const today = (i: number, d: string, title: string): Candidate => ({ ...cand(i, d, title), summary_kr: null });
  const deps: StoryRunDeps = {
    loadPublished: async () => ({ id: "b1", date: "2026-11-04", content: { top_stories: [{ rank: 2, title: "애플 중국판 AI 공개", subject: "알리바바", what: "w", refs: ["a1"], primary_ref: "a1" }] } as never }),
    hasRun: async () => false,
    existing: async () => new Set(),
    todayArticles: async () => [],
    candidates: async (plan) =>
      plan.lens === "company"
        ? [today(1, "2026-07-16", "애플 등록 심사 통과"), today(2, "2026-10-15", "쿡 10월 말 출시"), today(3, "2026-10-31", "애플 발표")]
        : [today(4, "2026-07-15", "애플 등록 목록"), today(5, "2026-10-15", "쿡 베타 예고"), today(6, "2026-10-16", "블룸버그 12월")],
    topicTitles: async (pattern) => [...Array(30)].map((_, i) => ({ title_kr: pattern.includes("중국판") || i % 3 ? "텐센트 바이두 화웨이" : "애플", title_cn: "" })),
    koRows: async () => [],
    titles: async () => new Map(),
    llm: async (c) => {
      if (c.system === PLAN_SYSTEM_)
        return { raw: { company: { name: "알리바바", terms: ["알리바바", "阿里"] }, actors: [{ name: "애플", terms: ["애플", "苹果"] }], topics: [{ level: "industry", name: "해외 기업의 중국 현지 AI 파트너", terms: ["중국판", "中国版"] }, { level: "market", name: "휴대폰 AI 비서 경쟁", terms: ["AI手机", "手机助手"] }] }, costUsd: 0 };
      if (c.system.startsWith("이번 기사(TODAY)와")) return { raw: { picked: ["C001", "C002", "C003"], thread_title: c.user.startsWith("LENS: company") ? "애플 인텔리전스 중국 출시" : "애플 인텔리전스 중국 출시와 제휴" }, costUsd: 0 };
      if (c.user.startsWith("LENS: topic")) synthTopics.push(/TOPIC: ([^\n]+)/.exec(c.user)![1]);
      const d = c.user.startsWith("LENS: company") ? ["07-16", "10-15", "10-31"] : ["07-15", "10-15", "10-16"];
      return { raw: { background: "배경", now: "지금", caution: "", timeline: d.map((x, i) => ({ date: x, text: "애플 인텔리전스 중국 출시 승인", refs: [`P0${i + 1}`] })) }, costUsd: 0 };
    },
    translateLlm: async () => null,
    save: async (rows) => (saved.push(...rows.map((r) => `${r.lens}:${r.locale}`)), rows.length),
    recordRun: async () => {},
  };
  const r = await ensureStoryContext({}, deps);
  assert.deepEqual(synthTopics, ["해외 기업의 중국 현지 AI 파트너", "휴대폰 AI 비서 경쟁"]); // 두 후보를 차례로 시도
  assert.deepEqual(saved, ["company:ko"]);
  assert.ok(r.problems.some((p) => p.includes("회사 흐름과 겹침")), r.problems.join("\n"));
});

test("주제 고른 기사: 이 기사 회사 사건은 최근 2개까지, 회사 흐름과 같은 날 근처는 1개만", () => {
  const c = (i: number, d: string, t: string) => cand(i, d, t);
  const picked = [c(1, "2026-03-31", "애플 베타 철회"), c(2, "2026-07-15", "애플 등록 목록"), c(3, "2026-08-01", "삼성 바이두"), c(4, "2026-10-15", "애플 쿡 예고"), c(5, "2026-10-19", "애플 카드"), c(6, "2026-09-01", "BMW 딥시크")];
  const out = limitActorPicks(picked, "애플|苹果", ["2026-07-16", "2026-10-15"]);
  // 애플 4건 중: 10-19(가까운 회사 사건 없음) + 10-15(같은 날 근처 1개) → 07-15 는 같은 날 근처 두 번째라 빠지고, 03-31 은 3번째라 빠진다
  assert.deepEqual(out.map((p) => p.id), ["id3", "id4", "id5", "id6"]);
  assert.equal(limitActorPicks(picked, null).length, 6);
});
