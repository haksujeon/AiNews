/**
 * 밤 보정: 저장 때 검사(insight_flags)에 걸린 최근 기사의 AI 인사이트를 다시 만든다 (2026-11-04, src/lib/insights.ts).
 *
 *   npx tsx scripts/insight-fix.ts                 # = --dry-run. 대상 수·깃발 종류만, LLM 호출 없음
 *   npx tsx scripts/insight-fix.ts --apply [--days 3] [--limit 40] [--min-weight 3]
 *
 * - 대상: insight_version = ins-v2, insight_flags 무게 >= --min-weight(기본 3: 한자·숫자·붙여 쓴 숫자 중 하나라도), 최근 --days 일.
 *   길이만 넘친 기사(무게 1)는 기본으로 건드리지 않는다.
 * - 생성은 n8n 과 같은 프롬프트·같은 입력(INSIGHT_SYSTEM, insightUserMessage), 같은 모델(haiku-5-5, 사고 끔).
 * - 새 결과를 같은 검사(cleanInsightItem → insightFlags)에 넣어 **무게가 줄 때만** 바꾼다. 아니면 그대로 두고
 *   insight_version 을 'ins-v2-fix1' 로 표시해 다음 밤에 다시 부르지 않는다(한 기사 한 번).
 * - 낙관적 갱신: ai_insights_kr 이 읽을 때와 같을 때만 쓴다. 바꾸기 전 값은 ~/backups/ainews/insight-fix-<시각>.jsonl 에 먼저 적는다.
 * - 비용 상한: INSIGHT_FIX_MAX_COST_USD (기본 0.5).
 */
import { loadEnvConfig } from "@next/env";
import { appendFileSync, mkdirSync } from "node:fs";
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
  const { INSIGHT_SYSTEM, INSIGHT_VERSION, cleanInsightItem, flagWeight, insightFlags, insightUserMessage } = await import("../src/lib/insights");
  type Flags = ReturnType<typeof insightFlags>;

  const apply = process.argv.includes("--apply");
  const days = Number(arg("days") ?? 3);
  const limit = Number(arg("limit") ?? 40);
  const minWeight = Number(arg("min-weight") ?? 3);
  const maxCost = Number(process.env.INSIGHT_FIX_MAX_COST_USD ?? 0.5);
  const model = "anthropic-api-haiku-5-5";

  const { rows } = await pool.query(
    `SELECT id::text, title_cn, title_kr, summary_cn, summary_kr, content_cn, ai_insights_kr, insight_flags
       FROM ai_news_ex
      WHERE insight_flags IS NOT NULL AND insight_version = $1 AND created_at > now() - make_interval(days => $2)
      ORDER BY created_at DESC`,
    [INSIGHT_VERSION, days]
  );
  const targets = rows.filter((r) => flagWeight(r.insight_flags as Flags) >= minWeight).slice(0, limit);
  const kinds: Record<string, number> = {};
  for (const r of rows) for (const f of r.insight_flags as Flags) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  console.log(JSON.stringify({ flagged: rows.length, targets: targets.length, minWeight, days, kinds }, null, 1));
  if (!apply) {
    await pool.end();
    return;
  }

  const dir = join(homedir(), "backups", "ainews");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `insight-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  let cost = 0;
  let fixed = 0;
  let kept = 0;
  for (const r of targets) {
    if (cost >= maxCost) {
      console.log(`비용 상한 $${maxCost} 도달 — 멈춤`);
      break;
    }
    const before = flagWeight(r.insight_flags as Flags);
    let next: Record<string, unknown> | null = null;
    try {
      const res = await chat({ model, system: INSIGHT_SYSTEM, messages: [{ role: "user", content: insightUserMessage(r) }], maxTokens: 3072, timeoutMs: 90_000 }, (u) => (cost += u.costUsd));
      next = cleanInsightItem(parseJsonContent<Record<string, unknown>>(res.content));
    } catch (e) {
      console.log(r.id, "생성 실패", (e as Error).message.slice(0, 120));
    }
    const flags = next ? insightFlags(next, r, { expectDetail: true }) : null;
    const ok = !!(next && flags && typeof next.ai_insights_kr === "string" && next.ai_insights_kr && flagWeight(flags) < before);
    appendFileSync(log, JSON.stringify({ id: r.id, before: { ai_insights_kr: r.ai_insights_kr, flags: r.insight_flags }, after: ok ? { ...next, flags } : null }) + "\n");
    if (ok && next && flags) {
      const s = (k: string) => (typeof next![k] === "string" && (next![k] as string).trim() ? (next![k] as string) : null);
      const { rowCount } = await pool.query(
        `UPDATE ai_news_ex SET ai_insights_kr = $2, ai_insights_en = COALESCE($3, ai_insights_en), ai_insights_cn = COALESCE($4, ai_insights_cn),
                ai_insights_detail_kr = $5, ai_insights_detail_en = $6, ai_insights_detail_cn = $7,
                key_terms = CASE WHEN $8::jsonb IS NULL OR $8::jsonb = '[]'::jsonb THEN key_terms ELSE $8::jsonb END,
                insight_flags = $9::jsonb, insight_version = $10
          WHERE id = $1::uuid AND ai_insights_kr IS NOT DISTINCT FROM $11`,
        [r.id, s("ai_insights_kr"), s("ai_insights_en"), s("ai_insights_cn"), s("ai_insights_detail_kr"), s("ai_insights_detail_en"), s("ai_insights_detail_cn"),
         Array.isArray(next.key_terms) ? JSON.stringify(next.key_terms) : null, flags.length ? JSON.stringify(flags) : null, `${INSIGHT_VERSION}-fix1`, r.ai_insights_kr]
      );
      if (rowCount) fixed++;
      console.log(r.id, `무게 ${before} → ${flagWeight(flags)}`, rowCount ? "바꿈" : "그새 바뀜, 건너뜀");
    } else {
      kept++;
      await pool.query(`UPDATE ai_news_ex SET insight_version = $2 WHERE id = $1::uuid AND insight_version = $3`, [r.id, `${INSIGHT_VERSION}-fix1`, INSIGHT_VERSION]);
      console.log(r.id, `무게 ${before} → ${flags ? flagWeight(flags) : "실패"}, 그대로 둠`);
    }
  }
  console.log(JSON.stringify({ fixed, kept, costUsd: Math.round(cost * 1e5) / 1e5, log }));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
