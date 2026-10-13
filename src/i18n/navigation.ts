import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// 로케일을 자동으로 붙여주는 Link/router. 앱 내부 이동은 next/link 대신 이것을 쓴다.
// (basePath "/ainews" 는 Next 가 Link/router 에 자동 적용)
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
