/**
 * 중국 중심 규칙의 대상 지역 전환 (2026-11-02): isChinaSubject 가 근거 기사 subject_region 을 쓰고,
 * 미판정(NULL)일 때만 예전 실체 규칙으로 돌아간다. 근거 없는 주체·항목은 치명. 근거 기사 열 목록(columns.ts)에 지역 열이 있어야 한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chinaByRegion, isChinaCandidate, isChinaSubject, isChinaSubjectLegacy, type SourceDoc } from "../../src/lib/briefing/rules";
import { SOURCE_ARTICLE_COLUMNS } from "../../src/lib/briefing/columns";
import { subjectMissingFromRefs, validateKo, contextFromArticles, chinaCentricCount } from "../../src/lib/briefing/validate";
import { storyRegion } from "../../src/lib/briefing/periodic/prompt";
import { parseRejudgeBody } from "../../src/lib/region-rejudge";
import { BACKFILL_METHOD_VERSIONS, isChinaRegion } from "../../src/lib/region";
import type { BriefingContent, CandidateArticle } from "../../src/lib/briefing/types";

const doc = (subject_region: string | null, title_kr = "제목"): SourceDoc => ({ title_kr, title_cn: "", summary_kr: "", subject_region });

test("isChinaRegion: CN 과 대만·홍콩·마카오(원시 값)는 중국", () => {
  for (const r of ["CN", "TW", "HK", "MO", "cn"]) assert.equal(isChinaRegion(r), true, r);
  for (const r of ["US", "KR", "GLOBAL", "OTHER", null, ""]) assert.equal(isChinaRegion(r), false, String(r));
});

test("isChinaSubject: 근거 기사 대상 지역 CN(대만·홍콩 포함) → 중국 주체", () => {
  // 정규화된 대만 기사 = CN + TW 태그 → CN
  assert.equal(isChinaSubject({ subject: "TSMC", subject_is_chinese: true }, [[{ ...doc("CN"), }]]), true);
  // 원시 TW/HK 값이 들어와도 CN 으로 본다
  assert.equal(isChinaSubject({ subject: "폭스콘", subject_is_chinese: true }, [[doc("TW")]]), true);
  assert.equal(isChinaSubject({ subject: "홍콩 거래소", subject_is_chinese: true }, [[doc("HK")]]), true);
  // 주간·월간 흐름(subject_is_chinese 없음)은 지역만
  assert.equal(isChinaSubject({ title: "에이전트 경쟁", text: "OpenAI 와 구글" }, [[doc("CN")], [doc("CN")], [doc("US")]]), true);
});

test("isChinaSubject: 지역이 US 면 제목에 중국 실체가 있어도 중국 주체가 아니다 (예전 규칙과 다름)", () => {
  const story = { subject: "엔비디아", title: "엔비디아, 알리바바에 H20 공급 재개", subject_is_chinese: false };
  assert.equal(isChinaSubjectLegacy(story), true); // 예전: 제목의 중국 실체(알리바바)로 중국
  assert.equal(isChinaSubject(story, [[doc("US")]]), false);
});

test("isChinaSubject: 교차 확인 — 지역 CN 이어도 LLM 이 subject_is_chinese:false 로 표시하면 세지 않는다", () => {
  assert.equal(isChinaSubject({ subject: "구글", subject_is_chinese: false }, [[doc("CN")]]), false);
  // 반대로 LLM 이 true 라고 해도 근거 기사가 US 면 세지 않는다 (10-28 '바이두' 항목: 근거가 구글 Genie 기사뿐)
  assert.equal(isChinaSubject({ subject: "바이두", title: "바이두 문심 OCR 2", subject_is_chinese: true }, [[doc("US")], [doc("US")]]), false);
});

test("isChinaSubject: 근거 기사가 모두 NULL 이면 예전 실체 규칙으로 (fallback)", () => {
  assert.equal(isChinaSubject({ subject: "바이트댄스", title: "바이트댄스 새 모델", subject_is_chinese: true }, [[doc(null)]]), true);
  assert.equal(isChinaSubject({ subject: "OpenAI", title: "OpenAI 발표", subject_is_chinese: true }, [[doc(null)]]), false);
  assert.equal(isChinaSubject({ subject: "쉰처", title: "쉰처 주가 급등", subject_is_chinese: true }), true); // 근거 없음 = 예전 규칙
  // 일부만 판정되어 있으면 판정된 기사로만 투표
  assert.equal(isChinaSubject({ subject: "딥시크", subject_is_chinese: true }, [[doc(null)], [doc("CN")]]), true);
});

test("chinaByRegion: ref(묶음) 단위 다수결 — 기사가 많은 사건 하나가 다른 ref 를 덮지 않는다, 동수는 중국", () => {
  const big = Array.from({ length: 9 }, () => doc("US"));
  assert.equal(chinaByRegion([big, [doc("CN")], [doc("CN")]]), true); // 기사 수로는 US 9:2, ref 로는 CN 2:1
  assert.equal(chinaByRegion([[doc("CN")], [doc("US")]]), true);
  assert.equal(chinaByRegion([[doc("US")], [doc("GLOBAL")], [doc("CN")]]), false);
  assert.equal(chinaByRegion([[doc(null)]]), null);
  // 평평한 목록도 받는다 (기사 하나 = 묶음 하나)
  assert.equal(isChinaSubject({ subject: "x", subject_is_chinese: true }, [doc("CN"), doc("CN"), doc("US")]), true);
});

test("isChinaCandidate: 지역 우선, 없으면 제목 중국 실체", () => {
  assert.equal(isChinaCandidate({ title_kr: "알리바바 새 모델", title_cn: "", subject_region: "US" }), false);
  assert.equal(isChinaCandidate({ title_kr: "앤트로픽 상장", title_cn: "", subject_region: "CN" }), true);
  assert.equal(isChinaCandidate({ title_kr: "알리바바 새 모델", title_cn: "", subject_region: null }), true);
});

test("근거 기사 열 목록에 subject_region·region_tags — 데일리·주간·관리자 로더가 같은 목록을 쓴다", () => {
  assert.match(SOURCE_ARTICLE_COLUMNS, /\bsubject_region\b/);
  assert.match(SOURCE_ARTICLE_COLUMNS, /region_tags/);
  for (const f of ["src/lib/briefing/repository.ts", "src/lib/briefing/periodic/generate.ts", "src/lib/briefing/admin.ts"]) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.match(src, /SELECT \$\{SOURCE_ARTICLE_COLUMNS\}/, f);
  }
});

test("storyRegion: STORIES 의 지역 표시는 검증기와 같은 chinaByRegion", () => {
  assert.deepEqual(storyRegion([doc("CN"), doc("CN"), doc("US")]), { region: "CN", cn: true });
  assert.deepEqual(storyRegion([doc("US")]), { region: "US" });
  assert.deepEqual(storyRegion([doc(null)]), {});
});

// ───────────────────────── 근거 없는 주체·항목 (치명)

const art = (id: string, title_kr: string, subject_region: string | null, summary_kr = ""): CandidateArticle => ({
  id, source_name: "量子位", source_url: null, category: "ai-tech", title_cn: "", title_kr, summary_kr, ai_insights_kr: "", key_terms: [], subject_region,
});

test("subjectMissingFromRefs: 주체가 근거 기사에 없으면 true", () => {
  const ctx = contextFromArticles([art("g1", "구글 Genie 4 공개", "US", "구글 딥마인드가 Genie 4 를 공개했다.")], "normal");
  assert.equal(subjectMissingFromRefs("바이두", ["g1"], ctx), true);
  assert.equal(subjectMissingFromRefs("구글", ["g1"], ctx), false);
  assert.equal(subjectMissingFromRefs("", ["g1"], ctx), false);
});

test("validateKo: 근거가 무관한 중국 주체 항목은 subject_not_in_refs·refs_all_irrelevant 치명이고 중국 주체로 세지 않는다", () => {
  const arts = [
    art("g1", "구글 Genie 4 공개", "US", "구글 딥마인드가 Genie 4 를 공개했다."),
    art("g2", "구글 Genie 4 시연", "US", "구글이 Genie 4 를 시연했다."),
  ];
  const ctx = contextFromArticles(arts, "short");
  const c: BriefingContent = {
    headline: "바이두 문심 OCR 2 공개", lede: "구글이 Genie 4 를 공개했다.", lede_refs: ["g1"],
    top_stories: [{ rank: 1, section: "models", subject: "바이두", subject_is_chinese: true, title: "바이두 문심 Unlimited OCR 2", what: "바이두가 OCR 모델을 공개했다.", why: "문서 인식.", refs: ["g1", "g2"], primary_ref: "g1" }],
    sections: [], key_numbers: [], companies_to_watch: [], term_of_the_day: null, clusters: [], excluded: [],
  };
  const { report } = validateKo(c, ctx);
  const rules = report.fatal.map((f) => f.rule);
  assert.ok(rules.includes("subject_not_in_refs"), rules.join(","));
  assert.ok(rules.includes("refs_all_irrelevant"), rules.join(","));
  assert.equal(chinaCentricCount(c, ctx), 0);
});

// ───────────────────────── 재판정 API 본문

test("parseRejudgeBody: 기본값·검사", () => {
  assert.deepEqual(parseRejudgeBody({}), {});
  assert.deepEqual(parseRejudgeBody({ since: "2026-11-02T14:00:00Z", limit: 50, dryRun: true }), { since: "2026-11-02T14:00:00.000Z", limit: 50, dryRun: true });
  assert.ok("error" in parseRejudgeBody({ since: "어제" }));
  assert.ok("error" in parseRejudgeBody({ limit: 0 }));
  assert.ok("error" in parseRejudgeBody({ dryRun: "yes" }));
  assert.ok("error" in parseRejudgeBody({ includeVersions: ["rule-v1; DROP"] }));
  assert.deepEqual(parseRejudgeBody({ includeVersions: ["rule-v1", "llm-v1"] }), { includeVersions: ["rule-v1", "llm-v1"] });
  // 재판정이 건너뛰는 판본 = 백필 방식 (n8n-v1 은 다시 본다)
  assert.ok(!BACKFILL_METHOD_VERSIONS.includes("n8n-v1"));
});
