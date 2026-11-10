import { renderLogo } from "@/lib/seo/og-card";
import { LOGO_SIZE } from "@/lib/seo/jsonld";

// 발행자 로고 PNG (JSON-LD Organization.logo). 워드마크는 언어와 관계없이 "SDSC AI NEWS"(meta.brand).
export const revalidate = 86400;

export async function GET() {
  return renderLogo("SDSC AI NEWS", LOGO_SIZE);
}
