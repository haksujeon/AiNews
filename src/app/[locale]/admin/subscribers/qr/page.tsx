import { AdminShell } from "@/components/admin/admin-shell";
import { SubscribeQr } from "@/components/admin/subscribe-qr";
import { absoluteUrl } from "@/lib/site";

// 구독 신청 QR 만들기 + 출처별 현황 (관리자). 신청 주소는 서버가 사이트 주소로 만든다.
export const dynamic = "force-dynamic";

export default function SubscribeQrPage() {
  const bases = { ko: absoluteUrl("ko", "/subscribe"), zh: absoluteUrl("zh", "/subscribe"), en: absoluteUrl("en", "/subscribe") };
  return (
    <AdminShell>
      <SubscribeQr bases={bases} />
    </AdminShell>
  );
}
