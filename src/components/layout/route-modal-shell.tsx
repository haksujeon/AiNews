"use client";

import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/*
 * 주소(URL)로 열리는 팝업의 공용 틀 — 기사 팝업(@modal/(.)news/[id])과 홈 날짜 브리핑 팝업(?briefing=)이 이 틀 하나를 쓴다 (Gate 2).
 *
 *  - 데스크톱(≥640px): 가운데 760px 상자, 최대 88vh, 안에서 스크롤.
 *  - 휴대폰(<640px): 화면 92% 높이의 바닥 시트. 같은 Dialog 에 휴대폰용 클래스만 다르다 (sheet.tsx 를 따로 쓰지 않는다).
 *  - 닫기 버튼 이름은 번역 문구(common.close).
 *  - 포커스 되돌리기: 닫은 뒤 포커스를 팝업을 연 링크로 돌린다. Esc·바깥 누르기·닫기 버튼(Radix 닫힘)과
 *    브라우저 뒤로가기(라우트가 바뀌어 틀이 통째로 사라짐) 두 길 모두. 목록이 다시 그려져도 찾을 수 있게 요소가 아니라
 *    선택자(data-focus-key 또는 링크 주소)로 기억한다. 다른 팝업이 이어서 열리면(브리핑 팝업 → 기사 팝업) 그 팝업이 포커스를 갖고,
 *    처음 연 링크는 그대로 기억해 마지막 팝업이 닫힐 때 돌려준다.
 */

// ───────────────────────── 포커스 되돌리기 (모듈 상태: 팝업이 바뀌어도 이어진다)

let origin: string | null = null;
let lastClick: { selector: string; at: number } | null = null;

function inDialog(el: Element | null): boolean {
  return Boolean(el?.closest('[role="dialog"]'));
}

function selectorFor(el: Element | null): string | null {
  if (!el || el === document.body || inDialog(el)) return null;
  const key = el.closest("[data-focus-key]")?.getAttribute("data-focus-key");
  if (key) return `[data-focus-key="${CSS.escape(key)}"]`;
  const href = el.closest("a[href]")?.getAttribute("href");
  return href ? `a[href="${CSS.escape(href)}"]` : null;
}

// Safari 는 링크를 눌러도 포커스를 주지 않으므로 마지막으로 누른 링크도 기억한다 (Enter 도 click 이벤트를 낸다)
if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      const sel = selectorFor(e.target instanceof Element ? e.target : null);
      if (sel) lastClick = { selector: sel, at: Date.now() };
    },
    true
  );
}

/** 이 요소(선택자)가 지금 여는 팝업의 출발점이다 — 링크의 onClick 에서 부른다 */
export function rememberFocusOrigin(selector: string) {
  origin = selector;
}

/** 팝업이 열릴 때(Radix 가 포커스를 옮기기 직전) 출발점을 잡는다. 팝업 안에서 연 팝업이면 처음 출발점을 유지 */
function captureOrigin() {
  const sel = selectorFor(document.activeElement) ?? (lastClick && Date.now() - lastClick.at < 3000 ? lastClick.selector : null);
  if (sel) origin = sel;
}

/** 열린 팝업이 없고 포커스가 갈 곳을 잃었을 때 출발점으로 돌린다. 목록이 다시 그려지는 동안은 잠깐 기다린다 */
export function restoreFocusOrigin() {
  const sel = origin;
  if (!sel || typeof document === "undefined") return;
  let tries = 0;
  const tick = () => {
    if (document.querySelector('[role="dialog"][data-state="open"]')) return; // 이어서 열린 팝업이 포커스를 갖는다
    const active = document.activeElement;
    if (active && active !== document.body && !inDialog(active) && active.isConnected) return; // 이미 다른 곳에 포커스
    const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find((x) => !inDialog(x));
    if (el) {
      el.focus({ preventScroll: true });
      return;
    }
    if (++tries < 30) setTimeout(tick, 50);
  };
  setTimeout(tick, 0);
}

// ───────────────────────── 틀

interface RouteModalShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** 스크롤해도 위에 붙어 있는 머리 줄(닫기 버튼 포함). 없으면 오른쪽 위에 닫기 버튼만 */
  stickyHeader?: ReactNode;
  className?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

export function RouteModalShell({ open, onOpenChange, children, stickyHeader, className, ...rest }: RouteModalShellProps) {
  const t = useTranslations("common");
  // 뒤로가기로 라우트가 바뀌면 Radix 닫힘 없이 통째로 사라진다 → 그때도 포커스를 돌린다
  useEffect(() => () => restoreFocusOrigin(), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...rest}
        showCloseButton={!stickyHeader}
        closeLabel={t("close")}
        onOpenAutoFocus={captureOrigin}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocusOrigin();
        }}
        className={cn(
          // grid(기본값) 대신 flex-col: grid 에서는 aspect-ratio 이미지 행이 0px 로 접혀 본문과 겹친다
          "flex flex-col gap-0 overflow-y-auto overscroll-contain rounded-md border-rule bg-background p-0 shadow-xl sm:max-h-[88vh] sm:max-w-[760px]",
          // 휴대폰: 바닥 시트
          "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:h-[92dvh] max-sm:max-h-[92dvh] max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-b-0",
          "max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:slide-in-from-bottom-10 max-sm:data-[state=closed]:slide-out-to-bottom-10",
          className
        )}
      >
        {stickyHeader && (
          <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-rule bg-background pb-1.5 pl-4 pr-2 pt-3 sm:py-2.5 sm:pl-8 sm:pr-4">
            {/* 휴대폰 시트 손잡이 (끌어 닫기는 v1 에 없음, 모양만) */}
            <div aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-rule sm:hidden" />
            <div className="min-w-0">{stickyHeader}</div>
            <DialogClose
              className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="modal-close"
            >
              <XIcon className="size-5" aria-hidden="true" />
              <span className="sr-only">{t("close")}</span>
            </DialogClose>
          </div>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}
