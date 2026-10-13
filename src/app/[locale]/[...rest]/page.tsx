import { notFound } from "next/navigation";

// 로케일 아래의 알 수 없는 경로를 [locale]/not-found.tsx(헤더 포함)로 보낸다.
export default function CatchAllNotFound() {
  notFound();
}
