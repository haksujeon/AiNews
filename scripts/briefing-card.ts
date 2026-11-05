/**
 * "한 장 요약" 카드 만들기 — 그림 명세(LLM + 코드 검사) → 카드 화면 캡처(Playwright) → briefing_media 에 검토 중으로 등록.
 *
 *   npx tsx scripts/briefing-card.ts [--date 2026-11-04] [--locale ko] [--base http://localhost:3012] [--render-only] [--no-register] [--approve]
 * --date 가 없으면 그 언어의 최신 발행 판.
 *
 * --render-only: 이미 있는 card-spec.json 으로 다시 찍기만 (LLM 호출 없음).
 * 카드 화면: /ainews/{locale}/briefing/{date}/card (card-spec.json 이 있어야 열린다). 운영 서버(3012)가 새 코드를 돌고 있어야 한다.
 * 명세 파일: BRIEFING_MEDIA_DIR/날짜/언어/card-spec.json. 검사에서 버린 것은 등록 note 와 명세 dropped 에 남는다.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  loadEnvConfig(process.cwd());
  process.env.NEXT_PUBLIC_BASE_PATH ??= "/ainews";
  const dateArg = arg("date");
  const locale = (arg("locale") ?? "ko") as "ko" | "en" | "zh";
  const base = (arg("base") ?? "http://localhost:3012").replace(/\/$/, "");
  if (dateArg !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) throw new Error("--date YYYY-MM-DD");

  const { default: pool } = await import("../src/lib/db");
  const { getPublishedBriefing } = await import("../src/lib/briefing/public");
  const { cardSpecPath } = await import("../src/lib/briefing/media-store");
  const cs = await import("../src/lib/briefing/card-spec");
  const { chat, parseJsonContent, BRIEFING_MODEL } = await import("../src/lib/briefing/llm");
  const { registerMedia } = await import("../src/lib/briefing/media-register");
  try {
    const b = await getPublishedBriefing(locale, dateArg);
    if (!b) throw new Error(`${dateArg ?? "최신"} ${locale} 발행본이 없습니다`);
    const date = b.edition_date;
    const { getMediaRow } = await import("../src/lib/briefing/media-store");
    if ((await getMediaRow(date, locale, "card"))?.status === "approved" && !flag("force")) {
      console.log(`${date} ${locale} 승인된 카드가 이미 있음 — 건너뜀 (--force 로 다시)`);
      return;
    }
    const specFile = cardSpecPath(date, locale);
    if (!specFile) throw new Error("명세 경로");

    let spec: import("../src/lib/briefing/card-spec").CardSpec;
    if (flag("render-only")) {
      // 저장된 명세도 지금 규칙으로 다시 검사한다 (규칙이 바뀌었을 수 있다)
      const saved = JSON.parse(readFileSync(specFile, "utf8"));
      spec = cs.validateCardSpec(b.content, saved, { edition_date: date, locale });
      writeFileSync(specFile, JSON.stringify(spec, null, 2));
    } else {
      let cost = 0;
      const res = await chat(
        { system: cs.cardSpecSystem(locale), messages: [{ role: "user", content: cs.buildCardSpecUser(b.content) }], model: BRIEFING_MODEL, maxTokens: 4000 },
        (u) => (cost += u.costUsd ?? 0)
      );
      spec = cs.validateCardSpec(b.content, parseJsonContent(res.content), { edition_date: date, locale });
      mkdirSync(dirname(specFile), { recursive: true });
      writeFileSync(specFile, JSON.stringify(spec, null, 2));
      console.log(`명세: ${specFile} · 비용 약 $${cost.toFixed(4)}`);
      for (const s of spec.stories) console.log(`  #${s.rank} ${s.figure.kind}${s.big ? ` · ${s.big.raw}` : ""}`);
      if (spec.dropped.length) console.log("  검사에서 버림:", spec.dropped.join(" | "));
    }

    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const out = join(tmpdir(), `briefing-card-${date}-${locale}-${Date.now()}.png`);
    try {
      // 가로형(기본, 페이지 "한눈에 보기"와 같은 칸) / --layout portrait = 예전 세로형 1080px
      const portrait = arg("layout") === "portrait";
      const page = await browser.newPage({ viewport: { width: portrait ? 1080 : 1600, height: portrait ? 1350 : 900 }, deviceScaleFactor: 2 });
      const url = `${base}${process.env.NEXT_PUBLIC_BASE_PATH}/${locale}/briefing/${date}/card${portrait ? "" : "?layout=landscape"}`;
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
      if (!resp || resp.status() !== 200) throw new Error(`카드 화면 ${resp?.status()} ${url}`);
      await page.evaluate(() => document.fonts.ready);
      const el = page.locator("[data-testid=briefing-card]");
      const box = await el.boundingBox();
      await el.screenshot({ path: out });
      console.log(`캡처: ${out} (${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)} CSS px, 2배)`);
    } finally {
      await browser.close();
    }

    if (!flag("no-register")) {
      const r = await registerMedia({
        date,
        locale,
        kind: "card",
        file: out,
        source: arg("layout") === "portrait" ? cs.CARD_SPEC_VERSION : `${cs.CARD_SPEC_VERSION}-landscape`,
        note: spec.dropped.length ? `검사에서 버림: ${spec.dropped.join(" | ")}`.slice(0, 900) : undefined,
      });
      console.log(`등록(검토 중): ${r.abs} ${r.width}×${r.height}`);
      // 카드의 숫자는 모두 검사를 통과한 것뿐이라(검사 실패 그림은 이미 버림) 자동 승인해도 된다
      if (flag("approve")) {
        const { setMediaStatus } = await import("../src/lib/briefing/media-register");
        await setMediaStatus(date, locale, "card", "approved");
        console.log("승인");
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
