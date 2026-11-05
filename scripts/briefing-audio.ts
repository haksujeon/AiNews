/**
 * 브리핑 음성 만들기 (NotebookLM brief, 사용자 결정 2026-11-05) — 자료 올리기 → 음성 생성 → 받아쓰기 → 숫자 대조 → 등록.
 *
 *   npx tsx scripts/briefing-audio.ts [--date 2026-11-04] [--locale ko] [--attempts 3] [--approve-on-pass] [--dry]
 *
 * --date 가 없으면 그 언어의 최신 발행 판. 숫자 대조(audio-check.ts checkTranscript)를 통과할 때까지 최대 --attempts 번 다시 만든다.
 * 통과하지 못하면 숫자가 가장 덜 틀린 것을 검토 중(review)으로 남긴다 (공개 화면에 안 보임). 통과 + --approve-on-pass 면 바로 승인.
 * 이미 승인된 음성이 있으면 아무것도 하지 않는다 (--force 로 다시 만들기).
 * NotebookLM: ~/.local/bin/notebooklm (로그인 세션은 그 프로필). 노트북 "AiNews 데일리 음성"을 찾거나 만들고, 자료는 끝나면 지운다.
 * 받아쓰기: LiteLLM gemini-2.5-flash (BRIEFING_TRANSCRIBE_MODEL) input_audio.
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NLM = process.env.NOTEBOOKLM_BIN || join(process.env.HOME ?? "", ".local/bin/notebooklm");
const NOTEBOOK_TITLE = "AiNews 데일리 음성";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function nlm(args: string[], timeoutMs = 20 * 60_000): string {
  return execFileSync(NLM, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
}
function nlmJson<T>(args: string[], timeoutMs?: number): T {
  const out = nlm([...args, "--json"], timeoutMs);
  return JSON.parse(out.slice(out.indexOf("{"))) as T;
}

function notebookId(): string {
  const { notebooks } = nlmJson<{ notebooks: { id: string; title: string }[] }>(["list"]);
  const found = notebooks.find((n) => n.title === NOTEBOOK_TITLE);
  if (found) return found.id;
  const created = nlmJson<{ id?: string; notebook?: { id: string } }>(["create", NOTEBOOK_TITLE]);
  const id = created.id ?? created.notebook?.id;
  if (!id) throw new Error("노트북을 만들지 못했습니다");
  return id;
}

async function transcribe(file: string): Promise<unknown> {
  const { parseJsonContent } = await import("../src/lib/briefing/llm");
  const { TRANSCRIBE_PROMPT } = await import("../src/lib/briefing/audio-check");
  const base = (process.env.LITELLM_BASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.LITELLM_API_KEY;
  if (!base || !key) throw new Error("LITELLM_BASE_URL / LITELLM_API_KEY 미설정");
  const small = `${file}.32k.mp3`;
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-b:a", "32k", small]);
  const data = readFileSync(small).toString("base64");
  // 한도(429)·서버 오류면 다음 모델로 (gemini-2.5-flash 무료 한도가 하루에 막힐 수 있다 — 2026-11-05 실측)
  const models = [...new Set([process.env.BRIEFING_TRANSCRIBE_MODEL || "gemini-2.5-flash", "gemini-2.5-flash-lite"])];
  let last = "";
  for (const model of models) {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        messages: [{ role: "user", content: [{ type: "text", text: TRANSCRIBE_PROMPT }, { type: "input_audio", input_audio: { data, format: "mp3" } }] }],
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: unknown } | null;
    const content = body?.choices?.[0]?.message?.content;
    if (res.ok && typeof content === "string") return parseJsonContent(content);
    const err = body?.error;
    last = `${model} ${res.status}: ${typeof err === "string" ? err : JSON.stringify(err ?? body).slice(0, 200)}`;
    log(`  받아쓰기 실패 ${last}`);
  }
  throw new Error(`받아쓰기 실패 — ${last}`);
}

interface Attempt {
  n: number;
  mp3: string;
  transcript: string;
  unknown: string[];
  chaptersFound: number;
  ok: boolean;
}

async function main() {
  loadEnvConfig(process.cwd());
  process.env.NEXT_PUBLIC_BASE_PATH ??= "/ainews";
  const locale = (arg("locale") ?? "ko") as "ko" | "en" | "zh";
  const attempts = Math.max(1, Math.min(5, Number(arg("attempts") ?? 3)));
  const { default: pool } = await import("../src/lib/db");
  const { getPublishedBriefing } = await import("../src/lib/briefing/public");
  const { getMediaRow } = await import("../src/lib/briefing/media-store");
  const { registerMedia, setMediaStatus } = await import("../src/lib/briefing/media-register");
  const ac = await import("../src/lib/briefing/audio-check");
  const { formatShortDate } = await import("../src/lib/briefing/view");
  const work = mkdtempSync(join(tmpdir(), "briefing-audio-"));
  let nb = "";
  let sid = "";
  try {
    const b = await getPublishedBriefing(locale, arg("date"));
    if (!b) throw new Error(`${arg("date") ?? "최신"} ${locale} 발행본이 없습니다`);
    const date = b.edition_date;
    const existing = await getMediaRow(date, locale, "audio");
    if (existing?.status === "approved" && !flag("force")) {
      log(`${date} ${locale} 승인된 음성이 이미 있음 — 건너뜀`);
      return;
    }
    const source = ac.audioSourceMarkdown(b.content, formatShortDate(date, locale));
    const srcFile = join(work, `briefing-${date}-${locale}.md`);
    writeFileSync(srcFile, source);
    if (flag("dry")) {
      log(`자료 ${srcFile}\n${source}`);
      return;
    }

    nb = notebookId();
    const added = nlmJson<{ id?: string; source_id?: string; source?: { id: string } }>(["source", "add", "-n", nb, srcFile]);
    sid = added.id ?? added.source_id ?? added.source?.id ?? "";
    if (!sid) throw new Error("자료를 올리지 못했습니다");
    log(`노트북 ${nb.slice(0, 8)} 자료 ${sid.slice(0, 8)} — 처리 대기`);
    await new Promise((r) => setTimeout(r, 25_000));

    const tries: Attempt[] = [];
    for (let n = 1; n <= attempts; n++) {
      log(`시도 ${n}/${attempts}: 음성 생성`);
      // 생성 요청과 완료 대기를 나눈다: generate --wait 는 기본 300초에서 끊기는데 음성은 그보다 오래 걸린다 (2026-11-05 실측)
      let taskId = "";
      try {
        const gen = nlmJson<{ task_id?: string; id?: string }>(
          ["generate", "audio", "-n", nb, "-s", sid, "--format", "brief", "--language", locale, "--no-wait", "--retry", "3", ac.AUDIO_INSTRUCTIONS],
          5 * 60_000
        );
        taskId = gen.task_id ?? gen.id ?? "";
      } catch (e) {
        log(`  생성 요청 실패: ${String((e as Error).message).slice(0, 200)}`);
        continue;
      }
      if (!taskId) {
        log("  생성 요청에 작업 번호가 없음");
        continue;
      }
      let status = "";
      try {
        const w = nlmJson<{ status?: string }>(["artifact", "wait", "-n", nb, taskId, "--timeout", "1500", "--interval", "15"], 27 * 60_000);
        status = w.status ?? "";
      } catch (e) {
        log(`  대기 실패: ${String((e as Error).message).slice(0, 200)}`);
      }
      if (status !== "completed") {
        log(`  생성이 끝나지 않음 (${status || "알 수 없음"})`);
        continue;
      }
      const gen = { task_id: taskId };
      const raw = join(work, `raw-${n}.mp4`);
      const mp3 = join(work, `audio-${n}.mp3`);
      nlm(["download", "audio", "-n", nb, "-a", gen.task_id, raw]);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-i", raw, "-vn", "-ac", "1", "-b:a", "64k", mp3]);
      try {
        nlm(["artifact", "delete", "-n", nb, "-y", gen.task_id]);
      } catch {
        /* 지우기 실패는 무시 (노트북에 남을 뿐) */
      }
      let rawTx: unknown;
      try {
        rawTx = await transcribe(mp3);
      } catch (e) {
        // 받아쓰기를 못 하면 대조할 수 없다 — 다시 만들어도 같으므로 멈추고 이 음성을 검토 중으로 남긴다
        tries.push({ n, mp3, transcript: "", unknown: ["(받아쓰기 실패)"], chaptersFound: 0, ok: false });
        log(`  ${(e as Error).message}`);
        break;
      }
      const lines = ac.linesFromJson(rawTx);
      const transcript = ac.transcriptText(lines);
      const chk = ac.checkTranscript(transcript, source, b.content.top_stories.length);
      tries.push({ n, mp3, transcript, unknown: chk.unknownNumbers, chaptersFound: chk.chaptersFound, ok: chk.ok });
      log(`  대조: 모르는 숫자 [${chk.unknownNumbers.join(", ")}] · 장 ${chk.chaptersFound}/${chk.storyCount}${chk.ok ? " · 통과" : ""}`);
      if (chk.ok) break;
    }
    if (!tries.length) throw new Error("음성을 하나도 만들지 못했습니다");

    // 통과한 것, 없으면 모르는 숫자가 가장 적고 장을 많이 찾은 것
    const best = tries.find((t) => t.ok) ?? [...tries].sort((a, b2) => a.unknown.length - b2.unknown.length || b2.chaptersFound - a.chaptersFound)[0];
    const txFile = best.transcript ? join(work, `transcript-${best.n}.txt`) : undefined;
    if (txFile) writeFileSync(txFile, best.transcript);
    const note = best.ok
      ? `NotebookLM brief · 숫자 대조 통과 (시도 ${best.n}/${tries.length})`
      : `NotebookLM brief · 숫자 대조 실패: 자료에 없는 숫자 [${best.unknown.join(", ")}], 장 ${best.chaptersFound}/${b.content.top_stories.length} — 사람이 듣고 판단`;
    const r = await registerMedia({ date, locale, kind: "audio", file: best.mp3, source: "notebooklm-brief", transcriptFile: txFile, note });
    log(`등록(검토 중): ${r.abs} · ${Math.round(r.duration ?? 0)}초 · 장 ${r.chapters.length}`);
    if (best.ok && flag("approve-on-pass")) {
      await setMediaStatus(date, locale, "audio", "approved");
      log("숫자 대조 통과 → 승인");
    }
  } finally {
    if (nb && sid) {
      try {
        nlm(["source", "delete", "-n", nb, "-y", sid]);
      } catch {
        /* 무시 */
      }
    }
    rmSync(work, { recursive: true, force: true });
    await pool.end();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString().slice(11, 19), e instanceof Error ? e.message : e);
  process.exit(1);
});
