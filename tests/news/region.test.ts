import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGION_BUCKET_SQL,
  REGION_CHIPS,
  highConfidenceRegion,
  normalizeRegion,
  parseClassifierRegion,
  parseRegionChip,
  regionBadges,
  regionBucketOf,
  regionChipSql,
  regionFromLlm,
  regionLabel,
  ruleRegion,
  sanitizeRegionFields,
  titleEchoMatches,
} from "../../src/lib/region";
import { EMPTY_FILTERS, buildNewsWhere, filtersToParams, hasActiveFilters, parseFilters } from "../../src/lib/news-query";

// ───────── 정규화 (결정 2: 대만·홍콩은 대표 지역 CN + 태그)

test("normalizeRegion: 대만·홍콩·마카오 → CN 대표 지역 + TW/HK 태그", () => {
  assert.deepEqual(normalizeRegion("TW"), { subject_region: "CN", region_tags: ["CN", "TW"] });
  assert.deepEqual(normalizeRegion("HK", ["US"]), { subject_region: "CN", region_tags: ["CN", "US", "HK"] });
  assert.deepEqual(normalizeRegion("MO"), { subject_region: "CN", region_tags: ["CN", "HK"] });
  // 대만이 두 번째 지역일 뿐이면 CN 태그를 더하지 않는다 (SiPearl×신다 = EU + TW, 엔비디아×TSMC = US + TW → 미중 배지 없음)
  assert.deepEqual(normalizeRegion("EU", ["TW"]), { subject_region: "EU", region_tags: ["EU", "TW"] });
  assert.deepEqual(normalizeRegion("US", ["TW"]), { subject_region: "US", region_tags: ["US", "TW"] });
  assert.deepEqual(regionBadges("US", normalizeRegion("US", ["TW"])!.region_tags), []);
});

test("normalizeRegion: GLOBAL 은 태그에 넣지 않고, 모르는 코드는 버린다", () => {
  assert.deepEqual(normalizeRegion("GLOBAL", ["NONE", "GLOBAL", "XX"]), { subject_region: "GLOBAL", region_tags: [] });
  assert.deepEqual(normalizeRegion(" us ", "cn, us"), { subject_region: "US", region_tags: ["CN", "US"] });
  assert.equal(normalizeRegion("MULTI"), null);
  assert.equal(normalizeRegion(""), null);
  assert.equal(normalizeRegion(null), null);
  assert.equal(normalizeRegion(42), null);
});

test("regionFromLlm: uc(미중 동시) → 태그 CN·US, s=NONE 은 태그 없음", () => {
  assert.deepEqual(regionFromLlm({ p: "CN", s: "NONE", uc: true }), { subject_region: "CN", region_tags: ["CN", "US"] });
  assert.deepEqual(regionFromLlm({ p: "US", s: "CN", uc: false }), { subject_region: "US", region_tags: ["CN", "US"] });
  assert.deepEqual(regionFromLlm({ p: "TW", s: "NONE" }), { subject_region: "CN", region_tags: ["CN", "TW"] });
  assert.equal(regionFromLlm({ p: "??" }), null);
});

// ───────── 고신뢰 규칙 (보고서 수정 사항)

test("규칙: 三星堆(삼성두)는 삼성(KR)이 아니다", () => {
  const a = { title_kr: "AI로 되살린 삼성두 유적, 3천 년 전 청동기 복원", title_cn: "AI复原三星堆青铜器", summary_kr: "쓰촨 삼성두 박물관이 AI 복원 결과를 공개했다." };
  assert.equal(ruleRegion(a).scores.KR ?? 0, 0);
  const v = highConfidenceRegion(a);
  assert.notEqual(v?.subject_region, "KR");
  // 진짜 삼성은 KR
  assert.equal(highConfidenceRegion({ title_kr: "삼성, AI 안경 공개", title_cn: "三星发布AI眼镜", summary_kr: "" })?.subject_region, "KR");
});

test("규칙: 번역문의 '국산·국내·우리나라' 는 중국", () => {
  for (const title of ["국산 GPU 첫 대규모 양산", "국내 대모델 사용자 1억 돌파", "우리나라 AI 산업 규모 1조 위안"]) {
    assert.equal(highConfidenceRegion({ title_kr: title, title_cn: "", summary_kr: "" })?.subject_region, "CN", title);
  }
});

test("규칙: 대만 기업(폭스콘·TSMC·UMC) → 대표 지역 CN + TW 태그 (결정 2)", () => {
  for (const title of ["폭스콘, AI 서버 매출 두 배", "TSMC 3분기 순이익 사상 최대", "UMC, 성숙 공정 가격 인상"]) {
    const v = highConfidenceRegion({ title_kr: title, title_cn: "", summary_kr: "" });
    assert.equal(v?.subject_region, "CN", title);
    assert.ok(v?.region_tags.includes("TW"), title);
  }
});

test("규칙: 제재·수출통제 기사는 규칙으로 정하지 않고 LLM 으로 넘긴다 (규칙 5)", () => {
  assert.equal(highConfidenceRegion({ title_kr: "미 상무부, 기적창투 제재 명단에 추가", title_cn: "", summary_kr: "" }), null);
  assert.equal(highConfidenceRegion({ title_kr: "엔비디아 H20 수출 통제 강화", title_cn: "", summary_kr: "" }), null);
});

test("규칙: 자회사는 모회사 국가 (딥마인드 = US), 해외 사업은 본사 국가 (TikTok = CN)", () => {
  assert.equal(highConfidenceRegion({ title_kr: "딥마인드, 새 단백질 모델 공개", title_cn: "", summary_kr: "" })?.subject_region, "US");
  assert.equal(highConfidenceRegion({ title_kr: "틱톡 유럽 데이터센터 가동", title_cn: "", summary_kr: "" }), null); // CN·EU 두 지역 → LLM
  assert.equal(highConfidenceRegion({ title_kr: "틱톡, 새 AI 편집 기능 출시", title_cn: "", summary_kr: "" })?.subject_region, "CN");
});

test("규칙: 제목에 지역이 둘 이상이거나 없으면 LLM 으로", () => {
  assert.equal(highConfidenceRegion({ title_kr: "중국 모델이 미국 모델을 앞섰다", title_cn: "", summary_kr: "" }), null);
  assert.equal(highConfidenceRegion({ title_kr: "AI 열풍은 식었나", title_cn: "", summary_kr: "" }), null);
});

test("규칙: 태그 = 대표 지역 + 요약 첫 문장의 다른 지역", () => {
  const v = highConfidenceRegion({ title_kr: "엔비디아 실적 발표", title_cn: "", summary_kr: "엔비디아의 중국 매출이 줄었다. 나머지 설명." });
  assert.deepEqual(v, { subject_region: "US", region_tags: ["CN", "US"] });
});

// ───────── 칩 → SQL

test("칩 → SQL: 중국 = CN, 미국 = US, 그 밖 = 판정 있음 AND CN·US 아님 (GLOBAL 포함), 전체 = 조건 없음", () => {
  assert.deepEqual([...REGION_CHIPS], ["ALL", "CN", "US", "OTHER"]);
  assert.equal(regionChipSql("CN"), "subject_region = 'CN'");
  assert.equal(regionChipSql("US"), "subject_region = 'US'");
  assert.equal(regionChipSql("OTHER"), "(subject_region IS NOT NULL AND subject_region NOT IN ('CN','US'))");
  assert.equal(regionChipSql("ALL"), null);
  // 버킷 함수·SQL 이 같은 규칙
  assert.equal(regionBucketOf("GLOBAL"), "OTHER");
  assert.equal(regionBucketOf("KR"), "OTHER");
  assert.equal(regionBucketOf("CN"), "CN");
  assert.equal(regionBucketOf(null), null);
  assert.match(REGION_BUCKET_SQL, /subject_region IS NULL THEN NULL/);
});

test("parseRegionChip: 모르는 값은 ALL, 대소문자 무시", () => {
  assert.equal(parseRegionChip("cn"), "CN");
  assert.equal(parseRegionChip("OTHER"), "OTHER");
  assert.equal(parseRegionChip("TW"), "ALL");
  assert.equal(parseRegionChip("'; DROP TABLE x;--"), "ALL");
  assert.equal(parseRegionChip(null), "ALL");
});

test("목록 필터: region 파라미터가 WHERE·URL·활성 표시로 이어진다 (API 3곳이 같은 buildNewsWhere)", () => {
  const f = parseFilters(new URLSearchParams("region=us&q=openai"));
  assert.equal(f.region, "US");
  const { where, values } = buildNewsWhere(f);
  assert.match(where, /subject_region = 'US'/);
  assert.deepEqual(values, ["%openai%"]); // 칩은 상수 조각 — 값으로 넘기지 않는다
  assert.equal(filtersToParams(f).get("region"), "US");
  assert.equal(hasActiveFilters({ ...EMPTY_FILTERS, region: "OTHER" }), true);
  assert.equal(filtersToParams(EMPTY_FILTERS).has("region"), false);
  assert.doesNotMatch(buildNewsWhere(EMPTY_FILTERS).where, /subject_region/);
});

// ───────── 배지·라벨

test("배지: 미중 = 태그 ⊇ {CN,US}, 한국 = KR ∈ 태그 (대표 지역이 한국이면 생략)", () => {
  assert.deepEqual(regionBadges("CN", ["CN", "US"]), ["us_china"]);
  assert.deepEqual(regionBadges("CN", ["CN", "KR"]), ["korea"]);
  assert.deepEqual(regionBadges("KR", ["KR"]), []);
  assert.deepEqual(regionBadges("US", ["CN", "US", "KR"]), ["us_china", "korea"]);
  assert.deepEqual(regionBadges(null, null), []);
  assert.equal(regionLabel("US", "ko"), "미국");
  assert.equal(regionLabel("CN", "zh"), "中国");
  assert.equal(regionLabel("GLOBAL", "en"), "Global");
  assert.equal(regionLabel(null, "ko"), "");
  assert.equal(regionLabel("TW", "ko"), "");
});

// ───────── n8n 분류기 줄 (제목 메아리 확인)

test("parseClassifierRegion: 지역·태그·메아리 열, 메아리가 틀리면 버린다", () => {
  const title = "「鸿海」AI服务器营收翻倍";
  assert.deepEqual(parseClassifierRegion("3 | Foxconn AI server revenue | Y | ai-biz | TW | CN,TW | 鸿海AI服务器", title), {
    subject_region: "CN",
    region_tags: ["CN", "TW"],
  });
  assert.equal(parseClassifierRegion("3 | Foxconn AI server revenue | Y | ai-biz | TW | CN,TW | 小米汽车发布", title), null);
  assert.equal(parseClassifierRegion("3 | Foxconn AI server revenue | Y | ai-biz", title), null); // 예전 형식 — 지역 없음
  assert.deepEqual(parseClassifierRegion("4 | AI hype cooling | N | economy | GLOBAL | - | AI热潮", "AI热潮退了吗"), { subject_region: "GLOBAL", region_tags: [] });
  assert.equal(titleEchoMatches("", "abc"), false);
  assert.equal(titleEchoMatches("鸿海AI", "「鸿海」AI服务器"), true);
});

test("예전 'Apply AI Filter'·'Shadow Compare' 줄 정규식은 지역 열이 붙어도 Y/N·분류를 그대로 읽는다", () => {
  const LINE_RE = /^\s*[`"]?(\d+)[`"]?\s*[|:：\-]?\s*(?:[^|\n]*\|\s*)?([YN])\b[ \t,:|\-]*([a-z][a-z\-]*)?/gim;
  const raw = "0 | OpenAI new funding round | Y | ai-biz | US | US | OpenAI完成\n1 | EV maker cuts car prices | N | economy | CN | CN | 某车企降价";
  const got = [...raw.matchAll(LINE_RE)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(got, [["0", "Y", "ai-biz"], ["1", "N", "economy"]]);
});

// ───────── upsert 정규화

test("sanitizeRegionFields: 틀린 대표 지역이면 세 열을 모두 뺀다 (CHECK 위반 500 방지), TW 는 CN 으로", () => {
  const a: Record<string, unknown> = { title_kr: "x", subject_region: "TW", region_tags: ["TW"], region_version: "n8n-v1" };
  sanitizeRegionFields(a);
  assert.deepEqual(a, { title_kr: "x", subject_region: "CN", region_tags: ["CN", "TW"], region_version: "n8n-v1" });
  const b: Record<string, unknown> = { title_kr: "x", subject_region: "MARS", region_tags: ["CN"], region_version: "n8n-v1" };
  sanitizeRegionFields(b);
  assert.deepEqual(b, { title_kr: "x" });
  const c: Record<string, unknown> = { title_kr: "x" };
  sanitizeRegionFields(c);
  assert.deepEqual(c, { title_kr: "x" });
});
