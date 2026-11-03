/**
 * "쉬운 AI 설명" 만들기 (2026-11-03 시범 — 정기 파이프라인에는 아직 넣지 않았다).
 *
 *   npx tsx scripts/briefing-easy-terms.ts [--date 2026-11-02] [--dry]
 *     - 그 날짜(없으면 최신)의 발행 ko 데일리 판 주요 기사 → 근거 기사 key_terms 후보 → Sonnet 1회(3개 언어) → 코드 검사 → 저장
 *     - --dry: 저장하지 않고 결과만 출력 (사람이 읽고 확인)
 *     - 저장: briefing_easy_terms (기사 = 주요 기사 primary_ref, 언어). 판 content·버전·검토 기록은 건드리지 않는다
 */
import { loadEnvConfig } from "@next/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());
  const dry = process.argv.includes("--dry");
  const pool = (await import("../src/lib/db")).default;
  const { chat, parseJsonContent } = await import("../src/lib/briefing/llm");
  const et = await import("../src/lib/briefing/easy-terms");
  const { saveEasyTerms } = await import("../src/lib/briefing/easy-terms-store");
  try {
    const { rows } = await pool.query(
      `SELECT to_char(edition_date, 'YYYY-MM-DD') AS date, content FROM daily_briefings
        WHERE status = 'published' AND edition_type = 'daily' AND locale = 'ko' AND ($1::date IS NULL OR edition_date = $1::date)
        ORDER BY edition_date DESC LIMIT 1`,
      [arg("date") ?? null]
    );
    if (!rows[0]) throw new Error("발행 ko 판 없음");
    const date = rows[0].date as string;
    const content = rows[0].content;
    const refs = [...new Set((content.top_stories as { refs: string[] }[]).flatMap((s) => s.refs))];
    const { rows: arts } = await pool.query(`SELECT id::text AS id, key_terms FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [refs]);
    const keyTerms = new Map(arts.map((a: { id: string; key_terms: unknown }) => [a.id, Array.isArray(a.key_terms) ? a.key_terms : []]));
    const stories = et.storyInputs(content, keyTerms);
    console.log(`${date}: 주요 기사 ${content.top_stories.length}건 중 후보 2개 이상 ${stories.length}건`);
    if (!stories.length) return;

    let cost = 0;
    const res = await chat(
      {
        model: et.EASY_TERMS_MODEL,
        effort: "low",
        system: et.EASY_TERMS_SYSTEM,
        messages: [{ role: "user", content: et.easyTermsUserPrompt(stories) }],
        maxTokens: 6000,
      },
      (u) => (cost += u.costUsd)
    );
    const { byArticle, problems } = et.checkEasyTerms(stories, parseJsonContent(res.content));

    for (const s of stories) {
      const r = byArticle.get(s.articleId);
      console.log(`\n#${s.rank} ${s.title}`);
      if (!r) {
        console.log("  (상자 없음)");
        continue;
      }
      for (const [i, k] of r.ko.entries()) {
        console.log(`  - ${k.name} (${k.term}, ${k.pinyin})\n    ko: ${k.easy}\n    en: ${r.en[i].name} — ${r.en[i].easy}\n    zh: ${r.zh[i].name} — ${r.zh[i].easy}`);
      }
    }
    if (problems.length) console.log(`\n검사에서 뺀 것:\n${problems.map((p) => `  ${p.story} ${p.term ?? ""}: ${p.reason}`).join("\n")}`);
    console.log(`\n비용 $${cost.toFixed(4)}`);
    if (dry) return console.log("--dry: 저장 안 함");
    const n = await saveEasyTerms(date, byArticle, et.EASY_TERMS_MODEL, cost);
    console.log(`저장 ${n}행 (${byArticle.size}기사 × 3언어)`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
