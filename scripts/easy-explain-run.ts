/**
 * 기사 "쉽게 풀어보기" 생성 (2026-11-10, src/lib/easy-explain.ts).
 *
 *   npx tsx scripts/easy-explain-run.ts --date 2026-11-10                 # 시험: 생성만, DB 에 쓰지 않음. 결과·비용을 파일로
 *   npx tsx scripts/easy-explain-run.ts --date 2026-11-10 --apply --from <시험 결과 jsonl>   # 시험 결과를 그대로 저장 (다시 생성하지 않음)
 *   npx tsx scripts/easy-explain-run.ts --date 2026-11-10 --apply          # 생성하면서 저장
 *
 * - 대상: 그 날짜(news_date, 베이징 날짜)의 공개 기사 중 본문이 있고 아직 풀이가 없는 것. --limit 로 줄일 수 있다.
 * - 비용 상한: EASY_EXPLAIN_MAX_COST_USD (기본 5). 넘으면 멈춘다.
 * - 저장은 ai_easy_* · ai_why_* · easy_flags · easy_version 만. 이미 풀이가 있는 행은 덮어쓰지 않는다(ai_easy_kr IS NULL 조건).
 */
import { loadEnvConfig } from "@next/env";
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadEnvConfig(process.cwd());
  const pool = (await import("../src/lib/db")).default;
  const { chat, parseJsonContent } = await import("../src/lib/briefing/llm");
  const { PUBLIC_NEWS_WHERE, isCalendarDate } = await import("../src/lib/news-query");
  const E = await import("../src/lib/easy-explain");

  const date = arg("date") ?? "";
  if (!isCalendarDate(date)) throw new Error("--date YYYY-MM-DD 가 필요합니다");
  const apply = process.argv.includes("--apply");
  const from = arg("from");
  const limit = Number(arg("limit") ?? 1000);
  const maxCost = Number(process.env.EASY_EXPLAIN_MAX_COST_USD ?? 5);

  const { rows } = await pool.query(
    `SELECT id::text, title_kr, title_cn, summary_kr, summary_cn, content_cn
       FROM ai_news_ex
      WHERE ${PUBLIC_NEWS_WHERE} AND news_date >= $1::date AND news_date < $1::date + interval '1 day'
        AND coalesce(content_cn, '') <> '' AND ai_easy_kr IS NULL
      ORDER BY created_at`,
    [date]
  );
  const targets = rows.slice(0, limit);
  console.log(JSON.stringify({ date, candidates: rows.length, targets: targets.length, apply, from: from ?? null }));

  const dir = join(homedir(), "ainews-reports", "easy-article-2026-11");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `run-${date}-${apply ? "apply" : "dry"}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

  type Rec = { id: string; result: ReturnType<typeof E.toEasyResult>; flags: ReturnType<typeof E.easyFlags>; usage?: unknown };
  const preset = new Map<string, Rec>();
  if (from) for (const line of readFileSync(from, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(line) as Rec; if (r.result) preset.set(r.id, r); }

  let cost = 0, inTok = 0, outTok = 0, ok = 0, failed = 0, saved = 0, flagged = 0, generated = 0;
  const t0 = Date.now();
  for (const a of targets) {
    let rec = preset.get(a.id);
    // 시험 결과를 쓸 때도 검사는 지금 규칙으로 다시 한다
    if (rec?.result) rec = { ...rec, flags: E.easyFlags(rec.result, a) };
    if (!rec) {
      if (from) continue; // --from 이면 파일에 있는 기사만
      if (cost >= maxCost) { console.log(`비용 상한 $${maxCost} 도달 — 멈춤`); break; }
      generated++;
      try {
        const r = await chat({ system: E.EASY_SYSTEM, messages: [{ role: "user", content: E.easyUserMessage(a) }], model: E.EASY_MODEL, effort: "low", maxTokens: 4000 }, (u) => { cost += u.costUsd; inTok += u.inputTokens; outTok += u.outputTokens; });
        const result = E.toEasyResult(parseJsonContent(r.content));
        rec = { id: a.id, result, flags: result ? E.easyFlags(result, a) : [], usage: r.usage };
      } catch (e) {
        rec = { id: a.id, result: null, flags: [], usage: String(e) };
      }
    }
    appendFileSync(out, JSON.stringify(rec) + "\n");
    if (!rec.result) { failed++; continue; }
    ok++;
    if (rec.flags.length) flagged++;
    if (apply) {
      const r = rec.result;
      const res = await pool.query(
        `UPDATE ai_news_ex SET ai_easy_kr=$2, ai_why_kr=$3, ai_easy_en=$4, ai_why_en=$5, ai_easy_cn=$6, ai_why_cn=$7, easy_flags=$8, easy_version=$9
          WHERE id=$1::uuid AND ai_easy_kr IS NULL`,
        [a.id, r.easy_kr, r.why_kr, r.easy_en, r.why_en, r.easy_cn, r.why_cn, rec.flags.length ? JSON.stringify(rec.flags) : null, E.EASY_VERSION]
      );
      saved += res.rowCount ?? 0;
    }
  }
  const n = ok + failed;
  console.log(JSON.stringify({
    done: n, ok, failed, flagged, saved, model: E.EASY_MODEL,
    costUsd: +cost.toFixed(4), perArticleUsd: generated ? +(cost / generated).toFixed(5) : 0, generated,
    inputTokens: inTok, outputTokens: outTok, seconds: Math.round((Date.now() - t0) / 1000), file: out,
  }, null, 1));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
