"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Zap, Lock, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/api-path";
import { extractErrorMessage } from "@/lib/api-error";
import { useRouter } from "@/i18n/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    let res: Response;
    try {
      res = await fetch(apiUrl("/api/admin/auth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      // fetch 자체가 실패한 경우만 네트워크 오류
      setError(t("networkError"));
      setLoading(false);
      return;
    }

    try {
      if (res.ok) {
        router.push("/admin/send-history");
        return;
      }
      // 502/503 등 JSON 이 아닌 응답도 상태 코드 기반 메시지로 보여준다.
      const fallback =
        res.status >= 500 ? t("serverError", { status: res.status }) : t("loginFailed");
      setError(await extractErrorMessage(res, fallback));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center space-y-2 pb-4">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold">{t("loginTitle")}</h1>
          <p className="text-sm text-muted-foreground">{tc("appName")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  className="pl-10"
                  autoFocus
                />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !password}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {t("signIn")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
