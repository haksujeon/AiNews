/**
 * 발행본 "왜 중요한가"(top_stories[].why)만 새 규칙(prompt.ts WHY_RULES, v4.6 규칙 19·20)으로 다시 쓰기 (2026-11-03 사용자 요청, 11-02 판).
 * 판을 다시 생성하지 않는다: 기사 선택·순서·제목·what·refs 는 그대로 (쉬운 AI 설명 상자도 그대로 붙는다).
 *
 *   npx tsx scripts/briefing-why-rewrite.ts --date 2026-11-02 --dry      LLM 으로 새 why 만 만들어 보여 줌 (저장 없음)
 *   npx tsx scripts/briefing-why-rewrite.ts --date 2026-11-02            ko 새 draft 저장 → en/zh 재번역 → AI 검토 2회 (발행 안 함)
 *   npx tsx scripts/briefing-why-rewrite.ts --publish <ko-draft-id>      검토 2회 통과·번역 둘 다 draft 일 때만 발행 (기존 발행본 superseded)
 */
import { loadEnvConfig } from "@next/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());
  const pool = (await import("../src/lib/db")).default;
  const { WHY_RULES, clipBody } = await import("../src/lib/briefing/prompt");
  const { chat, parseJsonContent, BRIEFING_MODEL, BRIEFING_EFFORT } = await import("../src/lib/briefing/llm");
  const { loadReviewInput } = await import("../src/lib/briefing/review/evidence");
  const { saveFixedDb, saveTranslationsDb } = await import("../src/lib/briefing/review/pipeline");
  const { retranslate } = await import("../src/lib/briefing/review/retranslate");
  const { reviewBriefing } = await import("../src/lib/briefing/review/review");
  const { decide, policyFromEnv } = await import("../src/lib/briefing/review/policy");
  const { updateReviewDecision } = await import("../src/lib/briefing/review/store");
  const { publishBriefing } = await import("../src/lib/briefing/publish");
  const { ensureEasyTerms, easyRunNote } = await import("../src/lib/briefing/easy-terms-run");
  try {
    const pubId = arg("publish");
    if (pubId) {
      const { rows } = await pool.query(`SELECT to_char(edition_date,'YYYY-MM-DD') AS date, version, status FROM daily_briefings WHERE id = $1::uuid AND locale = 'ko'`, [pubId]);
      if (!rows[0] || rows[0].status !== "draft") throw new Error("ko draft 가 아님");
      const { rows: tr } = await pool.query(
        `SELECT DISTINCT ON (locale) locale, status FROM daily_briefings WHERE source_briefing_id = $1::uuid ORDER BY locale, version DESC`,
        [pubId]
      );
      if (tr.length !== 2 || tr.some((t: { status: string }) => t.status !== "draft")) throw new Error(`번역이 둘 다 draft 가 아님: ${JSON.stringify(tr)}`);
      const { rows: rv } = await pool.query(
        `SELECT verdict, score, decision->>'eligible' AS eligible FROM briefing_reviews WHERE briefing_id = $1::uuid AND trigger = 'manual' AND status = 'done' ORDER BY created_at DESC LIMIT 2`,
        [pubId]
      );
      if (rv.length < 2 || rv.some((r: { eligible: string }) => r.eligible !== "true")) throw new Error(`검토 2회 통과가 아님: ${JSON.stringify(rv)}`);
      const res = await publishBriefing({ date: rows[0].date, version: rows[0].version, briefingId: pubId, editedBy: "admin", onlyIfLatest: true });
      console.log("발행", JSON.stringify(res));
      const e = await ensureEasyTerms({ date: rows[0].date });
      console.log("쉬운 AI 설명:", easyRunNote(e) || e.detail);
      return;
    }

    const date = arg("date");
    if (!date) throw new Error("--date 필요");
    const { rows } = await pool.query(
      `SELECT id::text AS id FROM daily_briefings WHERE edition_type = 'daily' AND edition_date = $1::date AND locale = 'ko' AND status = 'published'`,
      [date]
    );
    if (!rows[0]) throw new Error("발행 ko 판 없음");
    const input = await loadReviewInput(rows[0].id, { includeTranslations: false });
    const content = input.row.content as unknown as { top_stories: { rank: number; title: string; what: string; why: string; refs: string[] }[] };
    const byId = new Map(input.articles.map((a) => [a.id, a]));
    const stories = content.top_stories.map((s) => ({
      rank: s.rank,
      title: s.title,
      what: s.what,
      why_old: s.why,
      articles: s.refs
        .map((r) => byId.get(r))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .map((a) => ({ title_kr: a.title_kr, summary_kr: a.summary_kr, body_kr: clipBody(a.content_kr || "") })),
    }));
    const system = `당신은 '중국 AI 뉴스' 데일리 브리핑 편집자입니다. 이미 발행한 판의 주요 기사마다 "왜 중요한가(why)" 한 칸만 아래 규칙으로 다시 씁니다.
제목·what 은 바꾸지 않습니다. 근거는 각 기사의 ARTICLES(title_kr·summary_kr·body_kr)뿐입니다. 사전 지식으로 사실·수치·인물·날짜를 보태지 마십시오.
숫자를 쓸 때는 근거 기사에 나온 값과 단위를 그대로 씁니다(규칙 4). why 는 1~2문장 120자 이내(공백 포함, 엄수).

${WHY_RULES}

출력: JSON 하나만. {"why":{"1":"...","2":"..."}} (키는 rank)`;
    console.log(`근거 기사: ${stories.map((s) => `#${s.rank} ${s.articles.length}건`).join(", ")}`);
    if (stories.some((s) => !s.articles.length)) throw new Error("근거 기사를 못 찾은 주요 기사가 있음");
    const user = stories.map((s) => JSON.stringify({ rank: s.rank, title: s.title, what: s.what, why_old: s.why_old, ARTICLES: s.articles })).join("\n");
    let cost = 0;
    const res = await chat({ model: BRIEFING_MODEL, effort: BRIEFING_EFFORT, system, messages: [{ role: "user", content: user }], maxTokens: 4000 }, (u) => (cost += u.costUsd));
    const out = (parseJsonContent(res.content) as { why?: Record<string, unknown> }).why ?? {};
    const next = structuredClone(input.row.content) as typeof content;
    const changes: { rank: number; before: string; after: string }[] = [];
    for (const s of next.top_stories) {
      const w = out[String(s.rank)];
      if (typeof w !== "string" || !w.trim()) throw new Error(`rank ${s.rank} why 없음`);
      changes.push({ rank: s.rank, before: s.why, after: w.trim() });
      s.why = w.trim();
    }
    for (const c of changes) console.log(`#${c.rank} (${c.after.length}자)\n  전: ${c.before}\n  후: ${c.after}`);
    // 결정적 재검증: 원본에 이미 있던 치명은 빼고 새로 생긴 치명만 (AI 검토 수정과 같은 방식)
    const key = (f: { rule: string; detail: string }) => `${f.rule}|${f.detail}`;
    const before = new Set(input.revalidate(input.row.content).fatal.map(key));
    const re = input.revalidate(next as unknown as Record<string, unknown>);
    const newFatal = re.fatal.filter((f) => !before.has(key(f)));
    console.log(`\n결정적 검사: 새 치명 ${newFatal.length}${newFatal.length ? " " + JSON.stringify(newFatal) : ""}, 경고 ${re.warn.length} · 비용 $${cost.toFixed(4)}`);
    if (newFatal.length) throw new Error("새 치명 위반 — 저장하지 않음");
    if (process.argv.includes("--dry")) return;

    const info = { kind: "why_rewrite", rules: "ko-v4.6 규칙 19·20", from: { id: input.row.id, version: input.row.version }, changes, cost_usd: cost };
    const saved = await saveFixedDb(input, re.content, info, re.warn);
    await pool.query(`UPDATE daily_briefings SET edited_by = 'why-rewrite' WHERE id = $1`, [saved.id]);
    console.log(`\nko v${saved.version} draft ${saved.id}`);
    const tr = await retranslate(re.content, input.candidateArticles);
    await saveTranslationsDb(saved.id, input, tr, "why-rewrite-retranslate");
    console.log(`번역: ${tr.map((t) => `${t.locale} ${t.content ? "draft" : `failed (${t.problems.length})`}`).join(", ")}`);
    if (tr.some((t) => !t.content)) throw new Error("번역 실패 — 발행하지 않음");

    const policy = policyFromEnv();
    for (let i = 1; i <= 2; i++) {
      const r = await reviewBriefing(saved.id, { trigger: "manual", store: true, includeTranslations: true, policy });
      const rv = r.result;
      if (rv.status !== "done" || !r.input) throw new Error(`검토 ${i} 오류: ${rv.error}`);
      const d = decide(
        {
          review: rv, editionType: "daily", deterministicFatal: 0,
          translations: r.input.translations.map((t) => ({ locale: t.locale, status: t.status, problems: t.problems.length })),
          incompleteDays: r.input.incompleteDays,
          // 같은 판 발행본을 교체하는 수동 작업이라 "발행본 없음" 조건은 보지 않는다
          publishable: { ok: true, detail: "why 다시 쓰기 — 발행본 교체" },
        },
        policy
      );
      if (rv.id) await updateReviewDecision(rv.id, { decision: { ...d, final: false, action: "manual_review" } });
      console.log(`\n검토 ${i}: ${rv.verdict} ${rv.score}점 eligible=${d.eligible} — ${d.summary}`);
      for (const c of rv.claims.filter((c) => c.label !== "correct")) console.log(`  ! ${c.path} ${c.label}: ${c.claim} — ${c.note ?? ""}`);
    }
    console.log(`\n발행: npx tsx scripts/briefing-why-rewrite.ts --publish ${saved.id}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
