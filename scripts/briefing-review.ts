/**
 * AI 편집 검토 CLI — API(/api/internal/briefing/review)·관리자 "다시 검토"와 같은 함수를 부른다.
 *
 *   npx tsx scripts/briefing-review.ts prompt <briefing-id>               (프롬프트 크기만, LLM 호출 없음)
 *   npx tsx scripts/briefing-review.ts review <briefing-id> [--no-store] [--no-translations] [--trigger manual|calibration|dry_run]
 *   npx tsx scripts/briefing-review.ts pipeline [--dry-run] [--id <briefing-id>] [--type daily|weekly|monthly] [--date YYYY-MM-DD]
 *     (정기 실행과 같은 runReviewPipeline. --dry-run 은 수정본을 메모리에서만 만들고 결정만 기록 — 발행·새 버전 저장 없음)
 *
 * 환경변수는 .env.local 등에서 Next 와 같은 방식(@next/env)으로 읽는다.
 */
import { loadEnvConfig } from "@next/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  loadEnvConfig(process.cwd());
  const [cmd, id] = process.argv.slice(2);
  const { loadReviewInput } = await import("../src/lib/briefing/review/evidence");
  const { reviewBriefing } = await import("../src/lib/briefing/review/review");
  const { buildReviewSystemPrompt, buildReviewUserPrompt } = await import("../src/lib/briefing/review/prompt");
  const { runReviewPipeline } = await import("../src/lib/briefing/review/pipeline");
  const pool = (await import("../src/lib/db")).default;
  try {
    if (cmd === "prompt") {
      const input = await loadReviewInput(id, { includeTranslations: !flag("no-translations") });
      const sys = buildReviewSystemPrompt(input.editionType, input.translations.length > 0);
      const user = buildReviewUserPrompt({
        editionType: input.editionType, editionDate: input.row.edition_date, periodStart: input.periodStart, periodEnd: input.periodEnd,
        version: input.row.version, segments: input.segments, labelOf: input.labelOf, articles: input.articles, facts: input.facts,
        candidates: input.candidates, translations: input.translations, dataQualityNote: null,
      });
      console.log(JSON.stringify({ segments: input.segments.length, articles: input.articles.length, candidates: input.candidates.length, translations: input.translations.length, systemChars: sys.length, userChars: user.length }));
      if (flag("print")) console.log(user);
      return;
    }
    if (cmd === "review") {
      const trig = arg("trigger");
      const trigger = trig === "calibration" || trig === "dry_run" || trig === "manual" ? trig : "manual";
      const { result } = await reviewBriefing(id, { trigger, store: !flag("no-store"), includeTranslations: !flag("no-translations") });
      const { claims, fixes, ...rest } = result;
      console.log(JSON.stringify({ ...rest, errors: claims.filter((c) => c.label !== "correct"), fixes, claimCount: claims.length }, null, 1));
      return;
    }
    if (cmd === "pipeline") {
      const t = arg("type");
      const r = await runReviewPipeline({
        dryRun: flag("dry-run"),
        briefingId: arg("id"),
        editionType: t === "daily" || t === "weekly" || t === "monthly" ? t : undefined,
        date: arg("date"),
        trigger: flag("dry-run") ? "dry_run" : "pipeline",
      });
      console.log(JSON.stringify(r, null, 1));
      return;
    }
    console.error("usage: briefing-review.ts prompt|review|pipeline ...");
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
