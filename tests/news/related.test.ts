import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANY_MIN_SCORE, RELATED_SECTIONS, SECTION_LIMIT, rankRelated, scoreCandidates, type RelatedDoc } from "../../src/lib/related-rank";

const a = (id: string, p: Partial<RelatedDoc>): RelatedDoc => ({
  id,
  source_name: "Qbitai",
  category: "ai-tech",
  title_cn: "",
  title_kr: "",
  title_en: "",
  summary_kr: "",
  summary_cn: "",
  summary_en: "",
  terms: [],
  day: "2026-10-20",
  ...p,
});

// idf 가 뜻을 가지려면 말뭉치가 있어야 한다: 서로 무관한 기사 40건
const TOPICS = ["光伏组件出口", "新能源汽车销量", "外卖平台补贴", "短视频电商直播", "半导体设备招标", "智能手表新品", "云计算价格调整", "跨境物流仓储"];
const filler = Array.from({ length: 40 }, (_, i) =>
  a(`f${String(i).padStart(2, "0")}`, {
    source_name: ["36Kr", "Huxiu", "ITHome"][i % 3],
    title_cn: `${TOPICS[i % TOPICS.length]}第${i}期观察`,
    summary_cn: `${TOPICS[(i + 3) % TOPICS.length]}市场本周出现变化，业内人士给出不同判断。`,
    summary_en: `Market watch number ${i} on ${["solar", "EV", "delivery", "livestream"][i % 4]} trends.`,
    day: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
  })
);

const seed = a("seed", {
  source_name: "36Kr",
  title_cn: "深度求索发布新模型V4，推理成本下降一半",
  title_kr: "딥시크, 새 모델 V4 공개… 추론 비용 절반",
  title_en: "DeepSeek Releases V4, Halving Inference Cost",
  summary_cn: "深度求索今天发布V4模型，推理成本下降一半，并支持百万上下文窗口。",
  summary_en: "DeepSeek released V4 today, cutting inference cost in half and supporting a million-token context window.",
  terms: ["深度求索", "上下文窗口"],
});

const ids = (rs: { item: RelatedDoc }[]) => rs.map((r) => r.item.id);

test("전재(같은 글)는 '같은 사건 다른 매체' 로 — 기준 기사의 매체는 빼고 매체마다 1건", () => {
  const out = rankRelated(seed, [
    ...filler,
    a("repost-huxiu", { ...seed, id: "repost-huxiu", source_name: "Huxiu", day: "2026-10-20" }),
    a("repost-huxiu-2", { ...seed, id: "repost-huxiu-2", source_name: "Huxiu", day: "2026-10-21" }),
    a("repost-own", { ...seed, id: "repost-own", source_name: "36Kr", day: "2026-10-20" }),
  ]);
  assert.deepEqual(ids(out.sections.sameEvent), ["repost-huxiu"]);
  // 전재는 다른 묶음·한 줄 목록에 나오지 않는다
  for (const sec of ["flow", "company"] as const) assert.ok(!ids(out.sections[sec]).some((x) => x.startsWith("repost")), sec);
  assert.ok(!ids(out.ranked).some((x) => x.startsWith("repost")));
});

test("1일 이내 강한 겹침 = 같은 사건, 2일 이상 = 흐름·후속(최신순, 날짜 차이 부호)", () => {
  // 제목은 서로 다르게(전재로 묶이지 않게), 요약·고유명사는 기준 기사와 겹치게
  const near = (id: string, src: string, day: string, title: string) =>
    a(id, {
      source_name: src,
      day,
      title_cn: title,
      title_en: "DeepSeek V4 Goes Live",
      summary_cn: "深度求索V4模型正式上线，推理成本下降一半，百万上下文窗口开放给开发者。",
      summary_en: "DeepSeek made V4 available, with inference cost cut in half and a million-token context window.",
      terms: ["深度求索"],
    });
  const out = rankRelated(seed, [
    ...filler,
    near("event-synced", "Synced", "2026-10-21", "深度求索V4模型上线，推理价格腰斩"),
    near("event-xzy", "XinZhiYuan", "2026-10-19", "实测深度求索V4：百万上下文表现如何"),
    near("before-5d", "Synced", "2026-10-15", "传深度求索下周发布V4"),
    near("after-3d", "Huxiu", "2026-10-23", "V4发布三天后，开发者怎么看深度求索"),
    near("after-9d", "ITHome", "2026-10-29", "深度求索再降价，V4接口费用调整"),
  ]);
  assert.deepEqual(new Set(ids(out.sections.sameEvent)), new Set(["event-synced", "event-xzy"]));
  assert.deepEqual(ids(out.sections.flow), ["after-9d", "after-3d", "before-5d"]);
  assert.deepEqual(
    out.sections.flow.map((r) => r.score.gap),
    [9, 3, -5]
  );
});

test("같은 기업 소식: 기업 실체만 겹치는 기사. 정부·대학(cn_gov)만 겹치면 넣지 않는다", () => {
  // 기준 기사가 딥시크와 칭화대(cn_gov)를 함께 다룬다
  const s2 = a("s2", { ...seed, id: "s2", title_kr: `${seed.title_kr}… 칭화대와 협력`, summary_en: `${seed.summary_en} The work was done with Tsinghua.` });
  const cands = [
    ...filler,
    a("same-company", {
      title_cn: "深度求索招聘多模态研究员",
      title_kr: "딥시크, 멀티모달 연구원 채용",
      title_en: "DeepSeek Hiring Multimodal Researchers",
      summary_en: "The Hangzhou lab DeepSeek opened new research positions.",
      day: "2026-10-12",
    }),
    // 본문(요약)에서만 지나가듯 딥시크를 언급 — 제목에 기업이 없으면 "같은 기업 소식" 이 아니다
    a("mention-only", {
      title_cn: "某芯片公司发布推理加速卡",
      title_kr: "한 칩 회사, 추론 가속 카드 공개",
      summary_kr: "이 카드는 딥시크 모델도 돌릴 수 있다고 회사는 밝혔다.",
      summary_en: "The card can also run DeepSeek models, the company said.",
      day: "2026-10-14",
    }),
    a("gov-only", {
      title_cn: "清华发布机器人课程",
      title_kr: "칭화대, 로봇 강좌 개설",
      summary_en: "Researchers at Tsinghua opened a robotics course.",
      day: "2026-10-18",
    }),
  ];
  const out = rankRelated(s2, cands);
  // 점수 하한은 넘지만(실체 cn_gov + 고유명사 Tsinghua) 기업이 아니라 빠진다
  const gov = scoreCandidates(s2, cands).find((r) => r.item.id === "gov-only")!;
  assert.deepEqual(gov.score.sharedEntities, ["cn_gov"]);
  assert.ok(gov.score.raw >= COMPANY_MIN_SCORE, String(gov.score.raw));
  assert.deepEqual(ids(out.sections.company), ["same-company"]);
  const mention = scoreCandidates(s2, cands).find((r) => r.item.id === "mention-only")!;
  assert.ok(mention.score.sharedEntities.includes("deepseek") && !mention.score.companyInTitle);
  assert.deepEqual(out.sections.company[0].score.sharedEntities, ["deepseek"]);
  assert.ok(!RELATED_SECTIONS.some((sec) => ids(out.sections[sec]).includes("gov-only")));
});

test("관련 없는 후보뿐이면 세 묶음이 모두 빈다 (같은 분류라는 이유로 채우지 않음)", () => {
  const out = rankRelated(seed, filler);
  for (const sec of RELATED_SECTIONS) assert.equal(out.sections[sec].length, 0, sec);
  assert.equal(out.ranked.length, 0);
});

test("묶음마다 최대 3건, 기준 기사 자신은 빠지고, 묶음끼리 겹치지 않는다", () => {
  const HEADS = ["开发者热议", "券商点评", "海外反响", "价格战升级", "芯片适配", "开源社区", "企业接入", "教育应用", "政务试点", "金融落地", "游戏公司", "手机厂商"];
  const many = Array.from({ length: 12 }, (_, i) =>
    a(`m${i}`, {
      source_name: ["Synced", "Huxiu", "ITHome", "XinZhiYuan"][i % 4],
      day: `2026-10-${String(8 + i * 2).padStart(2, "0")}`,
      title_cn: `${HEADS[i]}：深度求索V4`,
      title_en: "DeepSeek V4",
      summary_cn: "深度求索今天发布V4模型，推理成本下降一半，并支持百万上下文窗口。",
      summary_en: seed.summary_en,
      terms: seed.terms,
    })
  );
  const out = rankRelated(seed, [seed, ...filler, ...many]);
  const all = RELATED_SECTIONS.flatMap((s) => ids(out.sections[s]));
  for (const sec of RELATED_SECTIONS) assert.ok(out.sections[sec].length <= SECTION_LIMIT, sec);
  assert.ok(!all.includes("seed"));
  assert.equal(new Set(all).size, all.length);
  // 흐름이 다 차서 밀려난 같은 이야기(강한 겹침)는 "같은 기업 소식" 으로 다시 나오지 않는다
  assert.equal(out.sections.company.length, 0, ids(out.sections.company).join(","));
  assert.equal(out.sections.flow.length, SECTION_LIMIT, JSON.stringify(RELATED_SECTIONS.map((s) => out.sections[s].map((r) => [r.item.id, r.score.raw.toFixed(2), r.score.cos.toFixed(2)]))));
});

test("결정적: 후보 순서를 바꿔도 결과가 같다", () => {
  const cands = [...filler, a("x1", { ...seed, id: "x1", source_name: "Huxiu" }), a("x2", { title_cn: "深度求索V4评测", title_en: "DeepSeek V4 Review", day: "2026-10-25" })];
  const one = rankRelated(seed, cands);
  const two = rankRelated(seed, [...cands].reverse());
  for (const sec of RELATED_SECTIONS) assert.deepEqual(ids(one.sections[sec]), ids(two.sections[sec]), sec);
});
