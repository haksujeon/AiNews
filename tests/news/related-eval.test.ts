/**
 * 관련 기사 라벨 평가 (DB 없음) — 관련 기사 검토(2026-11-02) evaluate.py 를 옮긴 것.
 *  - 말뭉치: tests/fixtures/related-corpus.json.br (scripts/related-fixture.ts 로 만든 고정본, 기준 기사 ±90일 공개 기사)
 *  - 라벨: tests/fixtures/related-labels.json  labels[seed][후보 id 앞 8자] = 2 관련 / 1 약함 / 0 무관
 *  - 운영과 같게: 후보 = 기준 기사 ±RELATED_WINDOW_DAYS 일, idf 도 그 창으로 센다 (rankRelated 기본값).
 *  - p@5 strict = 한 줄 목록(ranked) 상위 5건 중 라벨 2 / 5. 라벨 없는 후보·빈 칸은 0 (evaluate.py 와 같음).
 *    검토 스크립트(전체 말뭉치 idf) 0.42 → 창 idf 로도 0.42. 하한 0.35.
 *  - 묶음 정밀도(같은 사건·흐름)는 라벨 붙은 것만으로 잰다. "같은 기업" 은 라벨 기준(같은 이야기인가)과 목적이 달라 재지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { RELATED_WINDOW_DAYS, rankRelated, type RelatedDoc, type RelatedRanking } from "../../src/lib/related-rank";

const FX = join(__dirname, "../fixtures");
const docs = (JSON.parse(brotliDecompressSync(readFileSync(join(FX, "related-corpus.json.br"))).toString("utf8")) as { docs: RelatedDoc[] }).docs;
const fx = JSON.parse(readFileSync(join(FX, "related-labels.json"), "utf8")) as {
  seeds: string[];
  labels: Record<string, Record<string, number>>;
};
const byId = new Map(docs.map((d) => [d.id, d]));
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

const results = new Map<string, RelatedRanking<RelatedDoc>>();
for (const s of fx.seeds) {
  const seed = byId.get(s);
  if (!seed) continue;
  const cand = docs.filter((d) => d.id !== s && Math.abs(dayNum(d.day) - dayNum(seed.day)) <= RELATED_WINDOW_DAYS);
  results.set(s, rankRelated(seed, cand));
}
const label = (s: string, id: string) => fx.labels[s]?.[id.slice(0, 8)];

test("말뭉치에 라벨 기준 기사 20건이 모두 있다", () => {
  assert.equal(results.size, fx.seeds.length);
});

test("라벨 p@5 strict ≥ 0.35 (기존 방식 0.02, v1 0.18)", () => {
  let strict = 0;
  let soft = 0;
  const per: Record<string, (number | null)[]> = {};
  for (const [s, r] of results) {
    const lab = r.ranked.slice(0, 5).map((x) => label(s, x.item.id) ?? null);
    strict += lab.filter((v) => v === 2).length / 5;
    soft += lab.reduce<number>((a, v) => a + (v === 2 ? 1 : v === 1 ? 0.5 : 0), 0) / 5;
    per[s.slice(0, 8)] = lab;
  }
  const p5 = strict / results.size;
  console.log(JSON.stringify({ p5_strict: +p5.toFixed(3), p5_soft: +(soft / results.size).toFixed(3), per_seed: per }));
  assert.ok(p5 >= 0.35, `p@5 strict ${p5}`);
});

test("같은 사건 묶음: 라벨 붙은 것 중 관련(2) 비율 ≥ 0.8, 모두 1일 이내", () => {
  let n = 0;
  let rel = 0;
  for (const [s, r] of results) {
    for (const x of r.sections.sameEvent) {
      assert.ok(Math.abs(x.score.gap) <= 1, `${s.slice(0, 8)} ${x.item.id} gap ${x.score.gap}`);
      const v = label(s, x.item.id);
      if (v === undefined) continue;
      n++;
      if (v === 2) rel++;
    }
  }
  console.log(JSON.stringify({ sameEvent_labeled: n, relevant: rel }));
  assert.ok(n >= 5 && rel / n >= 0.8, `${rel}/${n}`);
});

test("흐름·후속 묶음: 라벨 붙은 것 중 관련 비율 ≥ 0.6, 모두 2일 이상, 최신순", () => {
  let n = 0;
  let rel = 0;
  for (const [s, r] of results) {
    const gaps = r.sections.flow.map((x) => x.score.gap);
    assert.deepEqual(gaps, [...gaps].sort((a, b) => b - a), s.slice(0, 8));
    for (const x of r.sections.flow) {
      assert.ok(Math.abs(x.score.gap) >= 2);
      const v = label(s, x.item.id);
      if (v === undefined) continue;
      n++;
      if (v === 2) rel++;
    }
  }
  console.log(JSON.stringify({ flow_labeled: n, relevant: rel }));
  assert.ok(n >= 10 && rel / n >= 0.6, `${rel}/${n}`);
});

test("빈 묶음: 관련 기사가 없는 기준 기사는 묶음이 비고(숨김), 억지로 채우지 않는다", () => {
  // 0a774e2b(국산 인터커넥트 칩)·e230d2ab(민첩손) — 라벨상 같은 이야기(같은 사건·흐름)가 거의 없음.
  // "같은 기업" 묶음은 라벨 기준(같은 이야기인가)과 목적이 달라 세지 않는다: e230d2ab 는 智元 행사 기사라
  // 로봇 기업 이름표(2026-11-02 추가) 이후 지위안 소식이 같은 기업 묶음에 정상적으로 들어온다.
  for (const s of ["0a774e2b-12c4-4d5c-918c-78489a708bea", "e230d2ab-6c4c-4f44-bf99-5e68c730dc38"]) {
    const r = results.get(s)!;
    const shown = r.sections.sameEvent.length + r.sections.flow.length;
    assert.ok(shown <= 1, `${s.slice(0, 8)} shown ${shown}`);
  }
  const emptyAll = [...results.values()].filter((r) => !r.sections.sameEvent.length && !r.sections.flow.length && !r.sections.company.length).length;
  assert.ok(emptyAll >= 1);
});
