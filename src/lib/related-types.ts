/**
 * 관련 기사 세 묶음의 모양 — 서버(related.ts)·API·클라이언트(supabase-client, 화면)가 함께 쓴다.
 * 이 파일은 DB 를 import 하지 않는다 (클라이언트 번들에 들어가도 된다).
 */
import type { NewsItem } from "./news-types";

export interface RelatedItem extends NewsItem {
  /** 기준 기사와의 날짜 차이(일). 음수 = 앞선 기사, 양수 = 뒤에 나온 기사 */
  gap: number;
}

/** sameEvent 같은 사건 다른 매체 / flow 관련 흐름·후속 보도(최신순) / company 같은 기업 소식 — 묶음마다 0~3건 */
export interface RelatedSections {
  sameEvent: RelatedItem[];
  flow: RelatedItem[];
  company: RelatedItem[];
}

export const EMPTY_RELATED: RelatedSections = { sameEvent: [], flow: [], company: [] };

export const hasRelated = (s: RelatedSections) => s.sameEvent.length + s.flow.length + s.company.length > 0;
