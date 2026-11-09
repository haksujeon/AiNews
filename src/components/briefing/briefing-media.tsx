"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Download, ImageIcon, Pause, Play, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BriefingDateLink } from "./briefing-date-link";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { chapterAt, chapterStart, formatClock, type BriefingAudio, type BriefingCard, type MediaChapter } from "@/lib/briefing/media";

/*
 * 브리핑 음성·한 장 요약 (시안: ~/ainews-reports/multimedia-2026-11-05, claude.ai artifact 7xo4EBcF…).
 * 재생기는 페이지에 하나(BriefingAudioProvider). 듣기 막대·목차 시각(ChapterTime)·"이 부분 듣기"(ListenHere)·아래 재생 막대(MiniPlayer)가
 * 모두 같은 재생기를 움직인다 (Gate 2). 재생기가 없는 곳(날짜 팝업 등)에서는 시각 버튼이 그려지지 않는다.
 * 카드·괘선·청자색만 쓴다 (그림자·둥근 카드 없음).
 */

interface StoryLabel {
  rank: number;
  title: string;
  /** 보이는 번호 (묶은 판의 해외 기사는 "해외 1"). 없으면 rank */
  label?: string;
}

interface AudioCtx {
  audio: BriefingAudio;
  playing: boolean;
  started: boolean;
  time: number;
  duration: number;
  rate: number;
  chapter: MediaChapter | null;
  stories: StoryLabel[];
  toggle: () => void;
  seek: (t: number, play?: boolean) => void;
  cycleRate: () => void;
  /** 듣기 막대(데스크톱 막대·휴대폰 짧은 버튼) 중 하나라도 화면에 보이는지 — 아래 재생 막대를 띄울지 */
  barVisible: boolean;
  observeBar: (el: HTMLElement) => () => void;
  miniClosed: boolean;
  closeMini: () => void;
}

const Ctx = createContext<AudioCtx | null>(null);
const RATES = [1, 1.25, 1.5];

export function BriefingAudioProvider({ audio, stories, children }: { audio: BriefingAudio; stories: StoryLabel[]; children: ReactNode }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(audio.duration_sec);
  const [rate, setRate] = useState(1);
  const [barVisible, setBarVisible] = useState(true);
  const seen = useRef(new Map<Element, boolean>());
  const [miniClosed, setMiniClosed] = useState(false);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onPlay = () => {
      setPlaying(true);
      setStarted(true);
      setMiniClosed(false);
    };
    const onPause = () => setPlaying(false);
    const onMeta = () => Number.isFinite(a.duration) && a.duration > 0 && setDuration(a.duration);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("seeked", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    a.addEventListener("loadedmetadata", onMeta);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("seeked", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
      a.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  // 숨겨진(display:none) 막대는 교차하지 않으므로, 화면 폭에 맞는 쪽 하나만 실제로 보인다
  const observeBar = useCallback((el: HTMLElement) => {
    if (typeof IntersectionObserver === "undefined") return () => {};
    const map = seen.current;
    const update = () => setBarVisible([...map.values()].some(Boolean));
    const io = new IntersectionObserver(([e]) => {
      map.set(el, e.isIntersecting);
      update();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      map.delete(el);
      update();
    };
  }, []);

  const play = useCallback(() => {
    const p = ref.current?.play();
    if (p) p.catch(() => {});
  }, []);
  const toggle = useCallback(() => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) play();
    else a.pause();
  }, [play]);
  const seek = useCallback(
    (t: number, andPlay = true) => {
      const a = ref.current;
      if (!a) return;
      a.currentTime = Math.max(0, t);
      setTime(a.currentTime);
      if (andPlay) play();
    },
    [play]
  );
  const cycleRate = useCallback(() => {
    const a = ref.current;
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    if (a) a.playbackRate = next;
    setRate(next);
  }, [rate]);

  // 잠금 화면·이어폰 버튼 (지원하는 브라우저만)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", play);
    navigator.mediaSession.setActionHandler("pause", () => ref.current?.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => seek((ref.current?.currentTime ?? 0) - 10, false));
    navigator.mediaSession.setActionHandler("seekforward", () => seek((ref.current?.currentTime ?? 0) + 10, false));
    return () => {
      for (const a of ["play", "pause", "seekbackward", "seekforward"] as MediaSessionAction[]) navigator.mediaSession.setActionHandler(a, null);
    };
  }, [play, seek]);

  const value = useMemo<AudioCtx>(
    () => ({
      audio,
      playing,
      started,
      time,
      duration,
      rate,
      chapter: chapterAt(audio.chapters, time),
      stories,
      toggle,
      seek,
      cycleRate,
      barVisible,
      observeBar,
      miniClosed,
      closeMini: () => {
        ref.current?.pause();
        setMiniClosed(true);
      },
    }),
    [audio, playing, started, time, duration, rate, stories, toggle, seek, cycleRate, barVisible, observeBar, miniClosed]
  );

  return (
    <Ctx.Provider value={value}>
      {/* 대본은 듣기 막대의 "대본 보기"로 제공 */}
      <audio ref={ref} src={audio.url} preload="metadata" />
      {children}
      <MiniPlayer />
    </Ctx.Provider>
  );
}

const useAudio = () => useContext(Ctx);

/**
 * 지금 음성에서 나오는 주요 기사 (재생을 시작한 뒤에만). 한눈에 보기 칸·줄이 밝아지고 진행 막대가 움직인다 (확정 시안 2026-11-05).
 * 재생기가 없는 곳에서는 null.
 */
export function usePlayingStory(): { rank: number; progress: number } | null {
  const a = useAudio();
  if (!a || !a.started || !a.chapter || a.chapter.rank === null) return null;
  const chs = a.audio.chapters;
  const i = chs.findIndex((c) => c === a.chapter);
  const end = chs[i + 1]?.t ?? a.duration;
  const span = Math.max(1, end - a.chapter.t);
  return { rank: a.chapter.rank, progress: Math.min(1, Math.max(0, (a.time - a.chapter.t) / span)) };
}

/** 페이지 주소 공유 — 공유 창이 있는 기기는 공유 창, 없으면 주소 복사 (한 장 요약·이미지 저장 버튼은 확정 시안에서 뺌) */
export function ShareButton({ title, className }: { title: string; className?: string }) {
  const t = useTranslations("briefing");
  const [msg, setMsg] = useState("");
  const pageUrl = () => (typeof location === "undefined" ? "" : location.href.split("#")[0]);
  const share = async () => {
    setMsg("");
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url: pageUrl() });
        return;
      }
      await navigator.clipboard.writeText(pageUrl());
      setMsg(t("shareCopied"));
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(pageUrl());
        setMsg(t("shareCopied"));
      } catch {
        setMsg(pageUrl());
      }
    }
  };
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="text-[12px] text-ink-3 empty:hidden" aria-live="polite">
        {msg}
      </span>
      <button
        type="button"
        onClick={share}
        className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-[4px] border border-rule px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="share-button"
      >
        <Share2 aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="max-sm:sr-only">{t("cardShare")}</span>
      </button>
    </span>
  );
}

/** 이 요소가 보이는 동안은 아래 재생 막대를 띄우지 않는다 */
function useBarRef<T extends HTMLElement>() {
  const a = useAudio();
  const ref = useRef<T>(null);
  const observe = a?.observeBar;
  useEffect(() => {
    if (!observe || !ref.current) return;
    return observe(ref.current);
  }, [observe]);
  return ref;
}

function useChapterLabel() {
  const t = useTranslations("briefing");
  const a = useAudio();
  if (!a) return "";
  const c = a.chapter;
  if (!c) return t("listenSub", { count: a.stories.length });
  if (c.rank === null) return c.t === 0 ? t("listenIntro") : t("listenOutro");
  const s = a.stories.find((x) => x.rank === c.rank);
  return s ? `${s.label ?? c.rank}. ${s.title}` : t("listenStory", { rank: c.rank });
}

function PlayIcon({ playing, className }: { playing: boolean; className?: string }) {
  return playing ? <Pause aria-hidden="true" className={className} fill="currentColor" /> : <Play aria-hidden="true" className={className} fill="currentColor" />;
}

/** 재생 위치 막대 (듣기 막대·아래 재생 막대 공용). 키보드 ←/→ 5초 */
function Progress({ tone = "light", marks = false }: { tone?: "light" | "dark"; marks?: boolean }) {
  const t = useTranslations("briefing");
  const a = useAudio();
  if (!a) return null;
  const d = a.duration || 1;
  const pct = Math.min(100, (a.time / d) * 100);
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("listenSeek")}
      aria-valuemin={0}
      aria-valuemax={Math.round(d)}
      aria-valuenow={Math.round(a.time)}
      aria-valuetext={`${formatClock(a.time)} / ${formatClock(d)}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        a.seek(((e.clientX - r.left) / r.width) * d, a.playing);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") a.seek(a.time + 5, a.playing);
        else if (e.key === "ArrowLeft") a.seek(a.time - 5, a.playing);
        else return;
        e.preventDefault();
      }}
      className="group relative flex h-5 cursor-pointer items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn("relative block h-1.5 w-full overflow-hidden rounded-full", tone === "dark" ? "bg-white/20" : "bg-rule")}>
        <span className={cn("absolute inset-y-0 left-0", tone === "dark" ? "bg-jade-bright" : "bg-jade")} style={{ width: `${pct}%` }} />
      </span>
      {marks &&
        a.audio.chapters
          .filter((c) => c.rank !== null)
          .map((c) => (
            <span key={c.t} aria-hidden="true" className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink-3/60" style={{ left: `${(c.t / d) * 100}%` }} />
          ))}
    </div>
  );
}

/**
 * 듣기 막대 — 리드 바로 아래. id="listen" (메일·홈의 "듣기" 링크가 여기로 온다).
 * 검토 중(관리자 화면)이면 "검토 중 · 공개 전" 표시.
 */
export function ListenBar({ className }: { className?: string }) {
  const t = useTranslations("briefing");
  const a = useAudio();
  const label = useChapterLabel();
  const barRef = useBarRef<HTMLDivElement>();
  if (!a) return null;
  const minutes = Math.max(1, Math.round(a.duration / 60));
  return (
    <section id="listen" aria-label={t("listenTitle", { minutes })} className={cn("scroll-mt-20", className)} data-testid="briefing-listen">
      <div ref={barRef} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border border-l-[3px] border-rule border-l-jade bg-paper px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <button
          type="button"
          onClick={a.toggle}
          aria-label={a.playing ? t("listenPause") : t("listenPlay")}
          className="row-span-2 grid h-11 w-11 place-items-center rounded-full bg-jade text-paper hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:row-span-1"
        >
          <PlayIcon playing={a.playing} className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[14.5px] font-[650] text-ink">
            {t("listenTitle", { minutes })}
            <span className="min-w-0 truncate text-[12.5px] font-normal text-ink-3" aria-live="polite">
              {a.started ? t("listenNow", { label }) : t("listenSub", { count: a.stories.length })}
            </span>
          </p>
          <Progress marks />
        </div>
        <div className="col-start-2 flex items-center gap-2 text-[12.5px] tabular-nums text-ink-3 sm:col-start-auto">
          <span>
            {formatClock(a.time)} / {formatClock(a.duration)}
          </span>
          <button
            type="button"
            onClick={a.cycleRate}
            aria-label={t("listenSpeed", { rate: a.rate })}
            className="min-h-8 min-w-11 rounded-[3px] border border-rule px-1.5 text-[12.5px] text-ink-2 hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {a.rate}×
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px] leading-relaxed text-ink-3">
        <span className="rounded-[3px] border border-rule px-1.5 py-px font-semibold text-ink-2">{t("aiVoice")}</span>
        {a.audio.status === "review" && (
          <span className="rounded-[3px] border border-ink-3 px-1.5 py-px font-semibold text-ink" data-testid="media-review-badge">
            {t("mediaReview")}
          </span>
        )}
        <span>{t("aiVoiceShort")}</span>
      </div>
      {/* 받아쓰기는 기계 받아쓰기라 오자(고유명사 등)가 있다 — 사람이 고치기 전까지는 검토 화면에서만 보인다 */}
      {a.audio.transcript && a.audio.status === "review" && (
        <details className="mt-1.5 text-[13px] text-ink-2">
          <summary className="inline-flex min-h-8 cursor-pointer items-center text-ink-2 underline decoration-rule underline-offset-4 hover:decoration-ink-2">
            {t("transcript")}
          </summary>
          <div className="mt-2 max-h-72 overflow-y-auto border-l-2 border-rule pl-3 leading-[1.7]">
            {a.audio.transcript.split(/\r?\n/).filter(Boolean).map((line, i) => (
              <p key={i}>{line.replace(/^\s*[A-Z]{1,3}\s*:\s*/, "")}</p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** 목차 줄 끝의 음성 시각. 그 기사 시각이 없거나 재생기가 없으면 아무것도 그리지 않는다 */
export function ChapterTime({ rank, className }: { rank: number; className?: string }) {
  const t = useTranslations("briefing");
  const a = useAudio();
  if (!a) return null;
  const at = chapterStart(a.audio.chapters, rank);
  if (at === null) return null;
  const on = a.started && a.chapter?.rank === rank;
  return (
    <button
      type="button"
      onClick={() => a.seek(at)}
      aria-label={t("listenHereAria", { rank, time: formatClock(at) })}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center rounded-sm px-1 text-[12px] tabular-nums hover:text-jade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "font-[650] text-jade" : "text-ink-3",
        className
      )}
      data-testid="chapter-time"
    >
      {formatClock(at)}
    </button>
  );
}

/** 기사 안 "이 부분 듣기 0:24" */
export function ListenHere({ rank, className }: { rank: number; className?: string }) {
  const t = useTranslations("briefing");
  const a = useAudio();
  if (!a) return null;
  const at = chapterStart(a.audio.chapters, rank);
  if (at === null) return null;
  const on = a.started && a.playing && a.chapter?.rank === rank;
  return (
    <button
      type="button"
      onClick={() => (on ? a.toggle() : a.seek(at))}
      aria-label={on ? t("listenPause") : t("listenHereAria", { rank, time: formatClock(at) })}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-jade bg-jade-weak text-jade" : "border-rule text-jade hover:border-jade",
        className
      )}
      data-testid="listen-here"
    >
      <PlayIcon playing={on} className="h-2.5 w-2.5" />
      {t("listenHere")} <span className="tabular-nums">{formatClock(at)}</span>
    </button>
  );
}

/**
 * 아래 재생 막대 — 재생을 시작했고 듣기 막대가 화면 밖일 때만. 닫으면 멈춘다.
 * 떠 있는 동안 본문 아래에 같은 높이의 여백을 두어 마지막 줄·꼬리말을 가리지 않는다 (Gate 3).
 * 휴대폰(768px 미만)은 하단 탭(bottom-tabs.tsx, h-16) 바로 위에 붙는다 — 탭 높이의 빈 칸은 탭이 이미 흐름에 둔다.
 */
function MiniPlayer() {
  const t = useTranslations("briefing");
  const a = useAudio();
  const label = useChapterLabel();
  const ref = useRef<HTMLDivElement>(null);
  const show = !!a && a.started && !a.barVisible && !a.miniClosed;

  useEffect(() => {
    if (!show || !ref.current) return;
    const el = ref.current;
    const body = document.body;
    const prev = body.style.paddingBottom;
    const apply = () => (body.style.paddingBottom = `${el.offsetHeight}px`);
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      body.style.paddingBottom = prev;
    };
  }, [show]);

  if (!a || !show) return null;
  return (
    <div
      ref={ref}
      role="region"
      aria-label={t("listenTitle", { minutes: Math.max(1, Math.round(a.duration / 60)) })}
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 bg-console pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] text-white md:bottom-0 md:pb-[env(safe-area-inset-bottom)]"
      data-testid="mini-player"
    >
      <div className="mx-auto grid max-w-3xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2">
        <button
          type="button"
          onClick={a.toggle}
          aria-label={a.playing ? t("listenPause") : t("listenPlay")}
          className="grid h-11 w-11 place-items-center rounded-full bg-jade-bright text-console focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <PlayIcon playing={a.playing} className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold">{label}</p>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Progress tone="dark" />
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-white/70">{formatClock(a.time)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={a.closeMini}
          aria-label={t("listenClose")}
          className="grid h-11 w-11 place-items-center rounded-sm text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/** 카드 출처에 따라 다른 고지 (우리 데이터로 그린 카드 / AI 그림) */
function cardNoteKey(card: BriefingCard): "cardNoteOwn" | "cardNoteAi" {
  return card.source.startsWith("card-") ? "cardNoteOwn" : "cardNoteAi";
}

/**
 * 한 장 요약 그림 버튼 줄 — 보기(크게 보기 대화상자) · 이미지 저장 · 공유 (사용자 결정 2026-11-05: 저장·공유 버튼 유지).
 * 화면의 요약은 "한눈에 보기"(briefing-glance.tsx, 같은 명세)가 글자로 보여 주고, 그림은 가져가는 용도.
 * 공유: 그림 파일을 공유할 수 있는 기기(휴대폰)는 그림을, 아니면 페이지 주소를, 그것도 안 되면 주소 복사.
 */
export function CardSummary({ card, date, className }: { card: BriefingCard; date: string; className?: string }) {
  const t = useTranslations("briefing");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const note = t(cardNoteKey(card));
  const fileName = `ai-news-briefing-${date.replace(/[^0-9a-z-]/gi, "")}.png`;
  const pageUrl = () => (typeof location === "undefined" ? "" : location.href.split("#")[0]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl());
      setMsg(t("shareCopied"));
    } catch {
      setMsg(pageUrl());
    }
  };
  const share = async () => {
    setMsg("");
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        const blob = await fetch(card.url).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
        const file = blob ? new File([blob], fileName, { type: blob.type || "image/png" }) : null;
        if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: t("cardTitle"), url: pageUrl() });
        else await navigator.share({ title: t("cardTitle"), url: pageUrl() });
        return;
      }
      await copy();
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") await copy();
    }
  };
  const btn =
    "inline-flex min-h-9 min-w-9 justify-center items-center gap-1.5 rounded-[4px] border border-rule px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const actions = (dark = false) => (
    <>
      <a
        href={card.url}
        download={fileName}
        className={dark ? cn(btn, "border-white/30 text-white/85 hover:border-white/60 hover:text-white focus-visible:ring-white") : btn}
        data-testid="card-save"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        {/* 휴대폰은 아이콘만 ("한눈에 보기" 제목 줄에 한 줄로) — 낭독기는 글자를 그대로 읽는다 */}
        <span className={dark ? undefined : "max-sm:sr-only"}>{t("cardSave")}</span>
      </a>
      <button
        type="button"
        onClick={share}
        className={dark ? cn(btn, "border-white/30 text-white/85 hover:border-white/60 hover:text-white focus-visible:ring-white") : btn}
        data-testid="card-share"
      >
        <Share2 aria-hidden="true" className="h-3.5 w-3.5" />
        <span className={dark ? undefined : "max-sm:sr-only"}>{t("cardShare")}</span>
      </button>
    </>
  );
  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid="card-actions">
        <button type="button" onClick={() => setOpen(true)} className={btn} data-testid="card-open">
          <ImageIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {t("cardTitle")}
          {card.status === "review" && <span className="text-[11px] text-ink-3">({t("mediaReview")})</span>}
        </button>
        {actions()}
        {/* 알림 글은 있을 때만 줄을 차지한다 */}
        <span className="text-[12px] text-ink-3 empty:hidden max-sm:basis-full max-sm:text-right" aria-live="polite">
          {msg}
        </span>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[100dvh] w-full max-w-[100vw] flex-col gap-0 rounded-none border-0 bg-console p-0 text-white shadow-none sm:max-h-[94dvh] sm:max-w-[640px]"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <DialogTitle className="text-[14px] font-semibold text-white">
              {t("cardTitle")} · {date}
            </DialogTitle>
            <DialogClose className="grid min-h-11 min-w-11 place-items-center rounded-sm text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <X aria-hidden="true" className="h-5 w-5" />
              <span className="sr-only">{t("cardClose")}</span>
            </DialogClose>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- 우리 API 가 주는 그림 */}
            <img src={card.url} alt={card.alt_text} width={card.width} height={card.height} className="mx-auto block h-auto w-full max-w-[620px]" />
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2.5">
            {actions(true)}
            <DialogDescription className="min-w-0 flex-1 basis-60 text-[12px] leading-[1.6] text-white/70">{note}</DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 휴대폰 머리: 듣기(짧은 버튼) + 한 장 요약 버튼 나란히. 듣기를 누르면 같은 재생기가 시작된다 */
export function ListenShort({ className }: { className?: string }) {
  const t = useTranslations("briefing");
  const a = useAudio();
  const barRef = useBarRef<HTMLButtonElement>();
  if (!a) return null;
  const minutes = Math.max(1, Math.round(a.duration / 60));
  return (
    <button
      ref={barRef}
      type="button"
      onClick={a.toggle}
      aria-label={a.playing ? t("listenPause") : t("listenPlay")}
      className={cn(
        "flex min-h-12 min-w-0 items-center gap-2.5 border border-l-[3px] border-rule border-l-jade bg-paper py-1.5 pl-1.5 pr-3 text-left hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      data-testid="listen-short"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-jade text-paper">
        <PlayIcon playing={a.playing} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 text-[13.5px] font-[650] leading-tight text-ink">
        {t("listenShort", { minutes })}
        <span className="block truncate text-[11.5px] font-normal text-ink-3">
          {t("aiVoice")} · {t("listenSub", { count: a.stories.length })}
        </span>
      </span>
    </button>
  );
}

/**
 * 재생기가 없는 곳(홈 어두운 카드·날짜 팝업)의 "듣기" — 그 판 브리핑 페이지의 듣기 막대(#listen)로 간다.
 * 소리는 페이지에서 사용자가 누를 때 난다 (자동 재생 없음). 메일의 듣기 버튼도 같은 #listen 으로 온다.
 */
export function ListenLink({ date, audio, tone = "light", className }: { date: string; audio: BriefingAudio | undefined; tone?: "light" | "dark"; className?: string }) {
  const t = useTranslations("briefing");
  if (!audio) return null;
  const minutes = Math.max(1, Math.round(audio.duration_sec / 60));
  return (
    <BriefingDateLink
      date={date}
      hash="listen"
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-[4px] border px-4 text-[15px] focus-visible:outline-none focus-visible:ring-2",
        tone === "dark" ? "border-white/25 text-white/90 hover:border-white/50 focus-visible:ring-white" : "border-rule text-ink hover:border-ink-3 focus-visible:ring-ring",
        className
      )}
      data-testid="listen-link"
    >
      <Play aria-hidden="true" className={cn("h-3.5 w-3.5", tone === "dark" ? "text-jade-bright" : "text-jade")} fill="currentColor" />
      {t("listenShort", { minutes })}
      <span className={cn("text-[12.5px]", tone === "dark" ? "text-white/55" : "text-ink-3")}>{t("aiVoice")}</span>
    </BriefingDateLink>
  );
}
