import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_CATEGORIES,
  SCOPE_CATEGORIES,
  isPublicCategory,
  isScopeCategory,
  publicCategoriesOf,
  scopeCategorySql,
} from "../../src/lib/categories";
import { EMPTY_FILTERS, buildNewsWhere, parseFilters } from "../../src/lib/news-query";
import { populationWhere } from "../../src/lib/metrics/period";
import { getCategoryLabel } from "../../src/lib/news-utils";

test("공개 분류는 AI 3개 (로봇은 결정 D10 승인 뒤 한 줄 추가)", () => {
  assert.deepEqual(PUBLIC_CATEGORIES.map((c) => c.code), ["ai-tech", "ai-product", "ai-biz"]);
  assert.deepEqual(SCOPE_CATEGORIES, ["ai-tech", "ai-product", "ai-biz"]);
  for (const c of ["ai-tech", "ai-product", "ai-biz"]) assert.ok(isPublicCategory(c));
  for (const c of ["economy", "tech", "society", "culture", "politics", "ai-", "AI-TECH", "", null, undefined]) assert.equal(isPublicCategory(c), false);
  assert.equal(isScopeCategory, isPublicCategory);
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
