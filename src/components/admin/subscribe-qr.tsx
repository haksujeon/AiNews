"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api-path";
import { extractErrorMessage } from "@/lib/api-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Lang = "ko" | "zh" | "en";
interface SourceRow {
  source: string | null;
  total: number;
  active: number;
  pending: number;
  inactive: number;
}

/**
 * 구독 신청 QR (사용자 결정 2026-11-05). 출처 이름(?src=)을 붙인 신청 주소를 QR 로 — 인쇄용 PNG(1200px)·SVG 받기.
 * QR 은 브라우저에서 만든다(qrcode). 받기는 관리자 화면(일반 페이지)이라 a[download] 가 동작한다.
 */
export function SubscribeQr({ bases }: { bases: Record<Lang, string> }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [source, setSource] = useState("");
  const [lang, setLang] = useState<Lang>("ko");
  const [svg, setSvg] = useState("");
  const [png, setPng] = useState("");
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [error, setError] = useState("");

  const slug = source.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const url = useMemo(() => `${bases[lang]}${slug ? `?src=${slug}` : ""}`, [bases, lang, slug]);

  useEffect(() => {
    let alive = true;
    const opts = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#16171a", light: "#ffffff" } };
    Promise.all([QRCode.toString(url, { ...opts, type: "svg" }), QRCode.toDataURL(url, { ...opts, width: 1200 })])
      .then(([s, p]) => {
        if (!alive) return;
        setSvg(s);
        setPng(p);
      })
      .catch(() => alive && setError("QR"));
    return () => {
      alive = false;
    };
  }, [url]);

  // 출처별 현황 — 화면을 열 때 한 번 (응답이 온 뒤에만 상태를 바꾼다)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/admin/subscribers/sources"));
        if (!alive) return;
        if (res.status === 401) return router.replace("/admin/login");
        if (!res.ok) return setError(await extractErrorMessage(res, t("loadFailed")));
        const data = await res.json();
        if (alive) setRows(Array.isArray(data?.data?.sources) ? data.data.sources : []);
      } catch {
        if (alive) setError(t("networkError"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, t]);

  const svgHref = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
  const file = `ainews-subscribe-qr${slug ? `-${slug}` : ""}-${lang}`;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("qrTitle")}</h1>
        <Link href="/admin/subscribers" className="text-sm underline underline-offset-4">
          {t("qrBack")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("qrLead")}</p>

      <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="rounded-md border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- 브라우저에서 만든 QR 그림 */}
          {png ? <img src={png} alt={url} width={236} height={236} className="h-auto w-full" /> : <div className="aspect-square" />}
        </div>
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="qr-source">{t("qrSource")}</Label>
            <Input id="qr-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="seminar-2611" />
          </div>
          <div className="space-y-2">
            <Label>{t("qrLang")}</Label>
            <div className="flex gap-2">
              {(["ko", "zh", "en"] as Lang[]).map((l) => (
                <Button key={l} type="button" size="sm" variant={lang === l ? "default" : "outline"} onClick={() => setLang(l)} aria-pressed={lang === l}>
                  {l.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("qrUrl")}</p>
            <p className="break-all rounded border bg-muted/30 px-3 py-2 font-mono text-xs">{url}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild disabled={!png}>
              <a href={png} download={`${file}.png`}>
                {t("qrPng")}
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild disabled={!svg}>
              <a href={svgHref} download={`${file}.svg`}>
                {t("qrSvg")}
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? t("qrCopied") : t("qrCopy")}
            </Button>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("qrStats")}</h2>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-2 text-left font-medium">{t("qrColSource")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("qrColTotal")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("qrColActive")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("qrColPending")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("qrColInactive")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source ?? "-"} className="border-b last:border-0">
                  <td className="px-4 py-2">{r.source ?? t("qrNoSource")}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.total}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.active}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.pending}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.inactive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
