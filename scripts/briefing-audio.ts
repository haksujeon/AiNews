/**
 * 브리핑 음성 만들기 (NotebookLM brief, 사용자 결정 2026-11-05) — 자료 올리기 → 음성 생성 → 받아쓰기 → 숫자 대조 → 등록.
 *
 *   npx tsx scripts/briefing-audio.ts [--date 2026-11-04] [--locale ko] [--attempts 3] [--approve-on-pass] [--dry] [--force] [--recheck]
 * --only-if-pass: 숫자 대조를 통과한 음성만 등록 (승인된 음성을 --force 로 바꿀 때).
 * --recheck: 새로 만들지 않고 등록된 음성을 다시 받아써 대조 (받아쓰기 한도·오인식으로 실패했을 때).
 *
 * --date 가 없으면 최근 3일(BRIEFING_MEDIA_LOOKBACK_DAYS) 발행 판 가운데 음성이 승인되지 않은 가장 최신 판 (모두 승인됐으면 건너뜀). 숫자 대조(audio-check.ts checkTranscript)를 통과할 때까지 최대 --attempts 번 다시 만든다.
 * 통과하지 못하면 숫자가 가장 덜 틀린 것을 검토 중(review)으로 남긴다 (공개 화면에 안 보임). 통과 + --approve-on-pass 면 바로 승인.
 * 이미 승인된 음성이 있으면 아무것도 하지 않는다 (--force 로 다시 만들기).
 * NotebookLM: ~/.local/bin/notebooklm (로그인 세션은 그 프로필). 노트북 "AiNews 데일리 음성"을 찾거나 만들고, 자료는 끝나면 지운다.
 * 받아쓰기: LiteLLM gpt-4o-transcribe → whisper-1 → Gemini (BRIEFING_TRANSCRIBE_MODELS). 대조용 두 번째 받아쓰기는 다른 모델.
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * 받아쓰기 한 번 → {lines:[{t,text}]}. 모델을 차례로 시도한다 (한도·서버 오류면 다음 모델).
 * 2026-11-13: Gemini(flash·lite)가 하루 한도(429)로 막혀 lite 두 번이 같은 숫자를 잘못 들어(93.72→93.77) 검사에서 떨어졌다
 * → OpenAI 받아쓰기(gpt-4o-transcribe·whisper-1, LiteLLM /v1/audio/transcriptions)를 앞에 둔다. 실측 9초 안팎, 숫자 정확.
 * second=true(대조용 두 번째 받아쓰기)는 순서를 바꿔 첫 번째와 다른 모델이 듣게 한다.
 */
const TRANSCRIBE_MODELS = (process.env.BRIEFING_TRANSCRIBE_MODELS || "gpt-4o-transcribe,whisper-1,gemini-2.5-flash,gemini-2.5-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const isAudioApiModel = (m: string) => /transcribe|whisper/i.test(m);

async function transcribe(file: string, locale: "ko" | "zh" | "en", second = false): Promise<unknown> {
  const { parseJsonContent } = await import("../src/lib/briefing/llm");
  const { transcribePrompt, linesFromPlainText } = await import("../src/lib/briefing/audio-check");
  const base = (process.env.LITELLM_BASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.LITELLM_API_KEY;
  if (!base || !key) throw new Error("LITELLM_BASE_URL / LITELLM_API_KEY 미설정");
  const small = `${file}.32k.mp3`;
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-b:a", "32k", small]);
  const audio = readFileSync(small);
  const models = second && TRANSCRIBE_MODELS.length > 1 ? [TRANSCRIBE_MODELS[1], TRANSCRIBE_MODELS[0], ...TRANSCRIBE_MODELS.slice(2)] : TRANSCRIBE_MODELS;
  let last = "";
  for (const model of models) {
    try {
      if (isAudioApiModel(model)) {
        const fd = new FormData();
        fd.append("model", model);
        fd.append("language", locale);
        const segments = /whisper/i.test(model);
        fd.append("response_format", segments ? "verbose_json" : "json");
        if (segments) fd.append("timestamp_granularities[]", "segment");
        fd.append("file", new Blob([audio], { type: "audio/mpeg" }), "audio.mp3");
        const res = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(300_000) });
        const body = (await res.json().catch(() => null)) as { text?: unknown; segments?: { start?: unknown; text?: unknown }[]; error?: unknown } | null;
        if (res.ok && typeof body?.text === "string") {
          log(`  받아쓰기 ${model}`);
          // 시각은 어차피 글자 수 비율로 다시 매긴다(retimeByLength) — 줄(문장) 나누기만 중요하다
          const segLines = (body.segments ?? []).flatMap((g) => linesFromPlainText(String(g.text ?? "")).map((l) => ({ t: Number(g.start) || 0, text: l.text })));
          return { lines: segLines.length ? segLines : linesFromPlainText(body.text) };
        }
        const err = body?.error;
        last = `${model} ${res.status}: ${typeof err === "string" ? err : JSON.stringify(err ?? body).slice(0, 200)}`;
      } else {
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: 8000,
            messages: [{ role: "user", content: [{ type: "text", text: transcribePrompt(locale) }, { type: "input_audio", input_audio: { data: audio.toString("base64"), format: "mp3" } }] }],
          }),
          signal: AbortSignal.timeout(300_000),
        });
        const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: unknown } | null;
        const content = body?.choices?.[0]?.message?.content;
        if (res.ok && typeof content === "string") {
          log(`  받아쓰기 ${model}`);
          return parseJsonContent(content);
        }
        const err = body?.error;
        last = `${model} ${res.status}: ${typeof err === "string" ? err : JSON.stringify(err ?? body).slice(0, 200)}`;
      }
    } catch (e) {
      last = `${model}: ${(e as Error).message.slice(0, 200)}`;
    }
    log(`  받아쓰기 실패 ${last}`);
  }
  throw new Error(`받아쓰기 실패 — ${last}`);
}

type AC = typeof import("../src/lib/briefing/audio-check");

/** 받아쓰기 → 대조. 모르는 숫자가 있으면 한 번 더 받아써 양쪽에 다 나온 것만 오류로 본다 (confirmedUnknown) */
async function verify(mp3: string, source: string, storyCount: number, ac: AC, locale: "ko" | "zh" | "en"): Promise<Omit<Attempt, "n" | "mp3">> {
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3]).toString().trim());
  const once = async (second: boolean) => {
    const transcript = ac.transcriptText(ac.retimeByLength(ac.linesFromJson(await transcribe(mp3, locale, second)), dur));
    return { transcript, chk: ac.checkTranscript(transcript, source, storyCount) };
  };
  let first;
  try {
    first = await once(false);
  } catch (e) {
    log(`  ${(e as Error).message}`);
    return { transcript: "", unknown: ["(받아쓰기 실패)"], chaptersFound: 0, ok: false };
  }
  let unknown = first.chk.unknownNumbers;
  if (unknown.length) {
    try {
      const second = await once(true);
      log(`  두 번째 받아쓰기: 모르는 숫자 [${second.chk.unknownNumbers.join(", ")}]`);
      unknown = ac.confirmedUnknown(unknown, second.chk.unknownNumbers);
    } catch (e) {
      log(`  두 번째 받아쓰기 실패: ${(e as Error).message}`);
    }
  }
  const ok = unknown.length === 0 && first.chk.chaptersFound === storyCount;
  return { transcript: first.transcript, unknown, chaptersFound: first.chk.chaptersFound, ok };
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
  if (!["ko", "zh", "en"].includes(locale)) throw new Error("--locale ko|zh|en");
  const attempts = Math.max(1, Math.min(5, Number(arg("attempts") ?? 3)));
  const { default: pool } = await import("../src/lib/db");
  const { getPublishedBriefing } = await import("../src/lib/briefing/public");
  const { getMediaRow, pendingMediaDate } = await import("../src/lib/briefing/media-store");
  const { registerMedia, setMediaStatus } = await import("../src/lib/briefing/media-register");
  const ac = await import("../src/lib/briefing/audio-check");
  const work = mkdtempSync(join(tmpdir(), "briefing-audio-"));
  let nb = "";
  let sid = "";
  try {
    // --date 가 없으면 최근 발행판 가운데 음성이 승인되지 않은 가장 최신 판 (카드와 같은 함수)
    const pick = arg("date") ?? (await pendingMediaDate(locale, "audio"));
    const b = await getPublishedBriefing(locale, pick);
    if (!b) throw new Error(`${pick ?? "최신"} ${locale} 발행본이 없습니다`);
    const date = b.edition_date;
    const existing = await getMediaRow(date, locale, "audio");
    if (existing?.status === "approved" && !flag("force")) {
      log(`${date} ${locale} 승인된 음성이 이미 있음 — 건너뜀`);
      return;
    }
    const source = ac.audioSourceMarkdown(b.content, ac.audioDateLabel(date, locale), locale);
    const srcFile = join(work, `briefing-${date}-${locale}.md`);
    writeFileSync(srcFile, source);
    if (flag("dry")) {
      log(`자료 ${srcFile}\n${source}`);
      return;
    }

    const tries: Attempt[] = [];
    // --recheck: 새로 만들지 않고 이미 등록된 음성을 다시 대조 (받아쓰기 쪽 문제로 실패했을 때)
    if (flag("recheck")) {
      const { mediaFilePath } = await import("../src/lib/briefing/media-store");
      const f = existing ? mediaFilePath(existing.path) : null;
      if (!f) throw new Error(`${date} ${locale} 등록된 음성이 없습니다`);
      const mp3 = join(work, "recheck.mp3");
      copyFileSync(f, mp3);
      const v = await verify(mp3, source, b.content.top_stories.length, ac, locale);
      tries.push({ n: 1, mp3, ...v });
      log(`  다시 대조: 모르는 숫자 [${v.unknown.join(", ")}] · 장 ${v.chaptersFound}/${b.content.top_stories.length}${v.ok ? " · 통과" : ""}`);
    }

    if (!tries.length) nb = notebookId();
    if (nb) {
      const added = nlmJson<{ id?: string; source_id?: string; source?: { id: string } }>(["source", "add", "-n", nb, srcFile]);
      sid = added.id ?? added.source_id ?? added.source?.id ?? "";
      if (!sid) throw new Error("자료를 올리지 못했습니다");
      log(`노트북 ${nb.slice(0, 8)} 자료 ${sid.slice(0, 8)} — 처리 대기`);
      await new Promise((r) => setTimeout(r, 25_000));
    }

    for (let n = 1; nb && n <= attempts; n++) {
      log(`시도 ${n}/${attempts}: 음성 생성`);
      // 생성 요청과 완료 대기를 나눈다: generate --wait 는 기본 300초에서 끊기는데 음성은 그보다 오래 걸린다 (2026-11-05 실측)
      let taskId = "";
      try {
        const gen = nlmJson<{ task_id?: string; id?: string }>(
          ["generate", "audio", "-n", nb, "-s", sid, "--format", "brief", "--language", ac.NOTEBOOKLM_LANG[locale], "--no-wait", "--retry", "3", ac.audioInstructions(locale, b.content.top_stories.length)],
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
      const v = await verify(mp3, source, b.content.top_stories.length, ac, locale);
      tries.push({ n, mp3, ...v });
      if (v.transcript === "") break; // 받아쓰기를 못 하면 다시 만들어도 같다 — 이 음성을 검토 중으로 남긴다
      log(`  대조: 모르는 숫자 [${v.unknown.join(", ")}] · 장 ${v.chaptersFound}/${b.content.top_stories.length}${v.ok ? " · 통과" : ""}`);
      if (v.ok) break;
    }
    if (!tries.length) throw new Error("음성을 하나도 만들지 못했습니다");

    // 통과한 것, 없으면 모르는 숫자가 가장 적고 장을 많이 찾은 것
    const best = tries.find((t) => t.ok) ?? [...tries].sort((a, b2) => a.unknown.length - b2.unknown.length || b2.chaptersFound - a.chaptersFound)[0];
    const txFile = best.transcript ? join(work, `transcript-${best.n}.txt`) : undefined;
    if (txFile) writeFileSync(txFile, best.transcript);
    const note = best.ok
      ? `NotebookLM brief · 숫자 대조 통과 (시도 ${best.n}/${tries.length})`
      : `NotebookLM brief · 숫자 대조 실패: 자료에 없는 숫자 [${best.unknown.join(", ")}], 장 ${best.chaptersFound}/${b.content.top_stories.length} — 사람이 듣고 판단`;
    // --only-if-pass: 통과하지 못하면 등록하지 않는다 (승인된 음성을 --force 로 다시 만들 때 — 실패작이 승인본을 덮지 않게)
    if (!best.ok && flag("only-if-pass")) {
      log(`통과 못 함 — 등록하지 않음 (기존 음성 그대로): ${note}`);
      return;
    }
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
