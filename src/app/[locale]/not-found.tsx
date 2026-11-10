import { useTranslations } from "next-intl";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

// 로케일 안에서의 404 (없는 기사 id, 없는 경로). 헤더/푸터를 유지해 사이트 안에서 길을 잃지 않게 한다.
export default function LocaleNotFound() {
  const t = useTranslations("notFound");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none flex-1 container mx-auto px-4 py-20 flex flex-col items-center text-center gap-4">
        <FileQuestion className="w-12 h-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground max-w-md">{t("description")}</p>
        {/* "뉴스 목록으로" 는 실제 뉴스 목록으로 (QA B-07·C-03: 홈으로 가고 있었다). 없는 브리핑 날짜도 여기로 오므로 브리핑 길도 둔다 (QA A-11) */}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/news">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t("backHome")}
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/briefing">{t("backBriefing")}</Link>
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
