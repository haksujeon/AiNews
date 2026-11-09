/**
 * 주요 기사 묶음 "중국 5 · 해외 3" (2026-11-09 사용자 결정 "반영").
 *
 * - 생성: 중국 주체 이야기를 앞에(최대 5건), 해외 이야기를 뒤에(최대 3건) 둔다. 헤드라인 = 중국 1위.
 *   중국 기사가 모자란 날은 있는 만큼만 (해외로 채우지 않는다).
 * - 판정: 묶음은 기사마다 group("cn" | "intl")으로 저장한다. 판정은 rules.ts isChinaSubject 하나 (근거 기사 대상 지역 + LLM 표시 교차 확인).
 *   번역판(en·zh)은 ko 판의 group 을 순서 그대로 이어받는다 — 번역 모델을 거치지 않는다.
 * - 화면: 사이트 브리핑·카드·오늘 홈·작은 브리핑 창은 두 묶음(중국 1~5 · 해외 1~3)으로, 아침 메일은 중국 묶음만 싣고
 *   해외 묶음은 제목만 보여 주며 사이트로 보낸다. 보이는 번호는 displayNo 하나로 계산한다 (Gate 2).
 * - 예전 판(group 이 없는 판)은 지금까지처럼 한 목록·1~5 번호로 보인다 (isGrouped false).
 *
 * 데이터 안의 rank(1~8)는 그대로 둔다 — 기사 바로가기(#story-6)·음성 강조·카드 명세가 rank 로 이어져 있다.
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트).
 */
import type { BriefingContent, TopStory } from "./types";

export type StoryGroup = "cn" | "intl";
export const GROUP_SLOTS: Record<StoryGroup, number> = { cn: 5, intl: 3 };
/** 메일·사이트에서 해외 묶음으로 가는 바로가기 */
export const INTL_ANCHOR = "intl";

type GroupedStory = Pick<TopStory, "rank"> & { group?: StoryGroup };

/** 모든 주요 기사에 group 이 있는 판 (2026-11-09 이후 생성). 아니면 예전 한 목록 */
export function isGrouped(stories: readonly GroupedStory[]): boolean {
  return stories.length > 0 && stories.every((s) => s.group === "cn" || s.group === "intl");
}

/** 화면용 묶음: 묶은 판이면 [중국, 해외](빈 묶음 제외), 예전 판이면 [전체 한 목록(group null)] */
export function storyGroups<T extends GroupedStory>(stories: readonly T[]): { group: StoryGroup | null; stories: T[] }[] {
  if (!isGrouped(stories)) return [{ group: null, stories: [...stories] }];
  return (["cn", "intl"] as const).map((g) => ({ group: g, stories: stories.filter((s) => s.group === g) })).filter((x) => x.stories.length);
}

/** 보이는 번호: 묶은 판은 묶음 안 순서(중국 1~5 · 해외 1~3), 예전 판은 rank */
export function displayNo(story: GroupedStory, stories: readonly GroupedStory[]): number {
  if (!isGrouped(stories) || !story.group) return story.rank;
  return stories.filter((s) => s.group === story.group).findIndex((s) => s.rank === story.rank) + 1 || story.rank;
}

/** 메일에 싣는 기사: 묶은 판은 중국 묶음만, 예전 판은 전부 */
export function mailStories<T extends GroupedStory>(stories: readonly T[]): { main: T[]; intl: T[] } {
  if (!isGrouped(stories)) return { main: [...stories], intl: [] };
  return { main: stories.filter((s) => s.group === "cn"), intl: stories.filter((s) => s.group === "intl") };
}

export interface ArrangeEdit {
  action: "drop";
  path: string;
  reason: string;
  before: unknown;
  after: null;
}

/**
 * 생성 단계 정리: 기사마다 group 을 정하고(isCn), 중국 묶음을 앞으로(같은 묶음 안에서는 원래 순서), 묶음별 상한을 넘는 기사는 뺀다.
 * rank 는 1부터 다시 매긴다. 여러 번 돌려도 같은 결과(멱등).
 */
export function arrangeTopStories<C extends Pick<BriefingContent, "top_stories">>(
  content: C,
  isCn: (s: TopStory) => boolean
): { content: C; edits: ArrangeEdit[] } {
  const tagged = content.top_stories.map((s) => ({ ...s, group: (isCn(s) ? "cn" : "intl") as StoryGroup }));
  const edits: ArrangeEdit[] = [];
  const kept: TopStory[] = [];
  for (const g of ["cn", "intl"] as const) {
    const list = tagged.filter((s) => s.group === g);
    list.forEach((s, i) => {
      if (i < GROUP_SLOTS[g]) kept.push(s);
      else
        edits.push({
          action: "drop",
          path: `top_stories[${tagged.indexOf(s)}]`,
          reason: `${g === "cn" ? "중국" : "해외"} 묶음 상한 ${GROUP_SLOTS[g]}건 초과`,
          before: content.top_stories[tagged.indexOf(s)],
          after: null,
        });
    });
  }
  return { content: { ...content, top_stories: kept.map((s, i) => ({ ...s, rank: i + 1 })) }, edits };
}

/** 번역판에 ko 판의 group 을 같은 순서로 붙인다 (번역 모델이 group 을 다루지 않게) */
export function copyGroups<C extends Pick<BriefingContent, "top_stories">>(target: C, source: Pick<BriefingContent, "top_stories">): C {
  if (!isGrouped(source.top_stories) || target.top_stories.length !== source.top_stories.length) return target;
  return { ...target, top_stories: target.top_stories.map((s, i) => ({ ...s, group: source.top_stories[i].group })) };
}
