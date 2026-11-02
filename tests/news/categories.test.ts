import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HIDDEN_CATEGORIES,
  HIDDEN_CATEGORIES,
  PUBLIC_CATEGORIES,
  SCOPE_CATEGORIES,
  VISIBLE_CATEGORIES,
  isPublicCategory,
  isScopeCategory,
  parseHiddenCategories,
  publicCategoriesOf,
  scopeCategorySql,
  visibleCategoriesOf,
} from "../../src/lib/categories";
import { FEED_CATEGORIES, parseFeedSlug } from "../../src/lib/feed";
import { CATEGORY_WEIGHT } from "../../src/lib/news-rank";
import { EMPTY_FILTERS, buildNewsWhere, parseFilters } from "../../src/lib/news-query";
import { populationWhere } from "../../src/lib/metrics/period";
import { getCategoryLabel } from "../../src/lib/news-utils";

test("공개 분류는 AI 3개 (로봇은 결정 D10 승인 뒤 한 줄 추가)", () => {
  assert.deepEqual(PUBLIC_CATEGORIES.map((c) => c.code), ["ai-tech", "ai-product", "ai-biz"]);
  assert.deepEqual(SCOPE_CATEGORIES, ["ai-tech", "ai-product", "ai-biz"]);
  for (const c of ["ai-tech", "ai-product", "ai-biz"]) assert.ok(isPublicCategory(c));
  for (const c of ["economy", "tech", "society", "culture", "politics", "ai-", "AI-TECH", "", null, undefined]) assert.equal(isPublicCategory(c), false);
  for (const c of ["ai-tech", "ai-product", "ai-biz"]) assert.ok(isScopeCategory(c));
  assert.equal(isScopeCategory("robotics"), false); // 3단계(백필) 전까지 범위 밖
  // 로봇 라벨은 미리 있어 PUBLIC_CATEGORIES 한 줄로 공개된다
  assert.equal(getCategoryLabel("robotics", "ko"), "로봇");
  assert.equal(getCategoryLabel("robotics", "zh"), "机器人");
});

test("scopeCategorySql: LIKE 'ai-%' 대신 목록 IN (컬럼 이름 검사)", () => {
  assert.equal(scopeCategorySql(), "category IN ('ai-tech', 'ai-product', 'ai-biz')");
  assert.equal(scopeCategorySql("n.category"), "n.category IN ('ai-tech', 'ai-product', 'ai-biz')");
  assert.throws(() => scopeCategorySql("category; DROP TABLE x"));
  assert.equal(populationWhere("ai"), "is_duplicate = FALSE AND is_hidden = FALSE AND category IN ('ai-tech', 'ai-product', 'ai-biz')");
  assert.equal(populationWhere("all"), "is_duplicate = FALSE AND is_hidden = FALSE");
});

test("parseFilters 는 공개 분류가 아닌 값을 버리고 중복을 없앤다", () => {
  const f = parseFilters(new URLSearchParams("categories=ai-tech,economy,ai-biz,ai-tech,culture,%20ai-product%20"));
  assert.deepEqual(f.categories, ["ai-tech", "ai-biz", "ai-product"]);
  assert.deepEqual(parseFilters(new URLSearchParams("categories=economy,tech")).categories, []);
  // 버려진 뒤에는 분류 조건이 붙지 않는다 (= 전체)
  assert.deepEqual(buildNewsWhere(parseFilters(new URLSearchParams("categories=economy"))), buildNewsWhere(EMPTY_FILTERS));
});

test("필터 칩 = DB 분류 ∩ 공개 분류, PUBLIC_CATEGORIES 순서", () => {
  assert.deepEqual(publicCategoriesOf(["ai-biz", "culture", "ai-tech", "economy", "ai-product", "tech"]), ["ai-tech", "ai-product", "ai-biz"]);
  assert.deepEqual(publicCategoriesOf(["economy"]), []);
});

test("숨김 분류: 기본 robotics, 빈 문자열이면 없음, 형식이 틀린 코드는 버린다", () => {
  assert.equal(DEFAULT_HIDDEN_CATEGORIES, "robotics");
  assert.deepEqual([...parseHiddenCategories(undefined)], ["robotics"]);
  assert.deepEqual([...parseHiddenCategories("")], []);
  assert.deepEqual([...parseHiddenCategories(" robotics , ai-biz,,BAD CODE,x'y ")], ["robotics", "ai-biz"]);
  // 테스트 환경은 NEXT_PUBLIC_HIDDEN_CATEGORIES 를 설정하지 않으므로 기본값
  assert.deepEqual([...HIDDEN_CATEGORIES], ["robotics"]);
});

test("숨김 스위치: robotics 를 범위에 넣어도 칩·필터·피드에는 숨김이 풀릴 때까지 안 나온다", () => {
  const scope = ["ai-tech", "ai-product", "ai-biz", "robotics"];
  assert.deepEqual(visibleCategoriesOf(scope, parseHiddenCategories(undefined)), ["ai-tech", "ai-product", "ai-biz"]);
  assert.deepEqual(visibleCategoriesOf(scope, parseHiddenCategories("")), scope);
  // 지금 범위(로봇 없음)에서는 노출 = 범위
  assert.deepEqual(VISIBLE_CATEGORIES, SCOPE_CATEGORIES);
  assert.equal(isPublicCategory("robotics"), false);
  assert.deepEqual(parseFilters(new URLSearchParams("categories=robotics")).categories, []);
  assert.deepEqual(publicCategoriesOf(["robotics", "ai-biz"]), ["ai-biz"]);
  // 분류 피드도 같은 목록 (Gate 2) — robotics 피드는 404(null)
  assert.deepEqual(FEED_CATEGORIES, VISIBLE_CATEGORIES);
  assert.equal(parseFeedSlug("ko", ["category", "robotics.xml"]), null);
});

test("로봇 라벨(3개 언어)·순위 가중 0.8", () => {
  assert.equal(getCategoryLabel("robotics", "ko"), "로봇");
  assert.equal(getCategoryLabel("robotics", "en"), "Robotics");
  assert.equal(getCategoryLabel("robotics", "zh"), "机器人");
  assert.equal(CATEGORY_WEIGHT.robotics, 0.8);
  assert.equal(CATEGORY_WEIGHT["ai-biz"], 0.8);
});
