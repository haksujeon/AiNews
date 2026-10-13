"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Power,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { getCategoryLabel } from "@/lib/news-utils";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/lib/api-error";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/use-debounce";
import { apiUrl } from "@/lib/api-path";

interface Subscriber {
  id: string;
  created_at: string;
  name: string;
  organization: string | null;
  email: string;
  categories: string[];
  language: string;
  is_active: boolean;
}

const ALL_CATEGORIES = [
  "all",
  "ai-tech",
  "ai-product",
  "ai-biz",
  "politics",
  "economy",
  "society",
  "culture",
  "tech",
];

/** 구독 카테고리 표시명 ("all" 은 관리자 메시지, 나머지는 사이트 공통 라벨) */
function categoryLabel(cat: string, locale: string, allLabel: string): string {
  return cat === "all" ? allLabel : getCategoryLabel(cat, locale);
}

export function SubscribersContainer() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Subscriber | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subscriber | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // 목록 로드 실패 / 개별 작업(상태 변경·삭제) 결과 안내
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const debouncedSearch = useDebounce(search, 300);

  /** 401 이면 로그인 페이지로 보내고 true. (세션 만료) */
  const handleUnauthorized = useCallback(
    (res: Response) => {
      if (res.status !== 401) return false;
      router.replace("/admin/login");
      return true;
    },
    [router]
  );

  const failMessage = useCallback(
    (res: Response, fallback: string) =>
      extractErrorMessage(res, res.status >= 500 ? t("serverError", { status: res.status }) : fallback),
    [t]
  );

  const fetchSubscribers = useCallback(async () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (activeFilter !== "all") params.set("active", activeFilter);
    try {
      const res = await fetch(apiUrl(`/api/admin/subscribers?${params}`));
      if (handleUnauthorized(res)) return;
      if (!res.ok) {
        setLoadError(await failMessage(res, t("loadFailed")));
        return;
      }
      const data = await res.json();
      setSubscribers(data.data?.subscribers || []);
      setLoadError("");
    } catch {
      setLoadError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, activeFilter, handleUnauthorized, failMessage, t]);

  useEffect(() => {
    fetchSubscribers();
  }, [fetchSubscribers]);

  const handleSave = async (formData: FormData) => {
    setSaving(true);
    setFormError("");

    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const organization = formData.get("organization") as string;
    const language = formData.get("language") as string;
    const categoriesStr = formData.get("categories") as string;
    const categories = categoriesStr ? categoriesStr.split(",") : ["all"];

    const body = { name, email, organization, language, categories };

    try {
      const url = editTarget
        ? apiUrl(`/api/admin/subscribers/${editTarget.id}`)
        : apiUrl("/api/admin/subscribers");
      const method = editTarget ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (handleUnauthorized(res)) return;
      if (!res.ok) {
        setFormError(await failMessage(res, t("saveFailed")));
        return;
      }

      setFormOpen(false);
      setEditTarget(null);
      await fetchSubscribers();
    } catch {
      setFormError(t("networkError"));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (sub: Subscriber) => {
    setNotice(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/subscribers/${sub.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !sub.is_active }),
      });
      if (handleUnauthorized(res)) return;
      if (!res.ok) {
        setNotice({ kind: "error", text: await failMessage(res, t("toggleFailed")) });
        return;
      }
      setNotice({ kind: "success", text: t("toggled") });
      await fetchSubscribers();
    } catch {
      setNotice({ kind: "error", text: t("networkError") });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setNotice(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/subscribers/${deleteTarget.id}`), {
        method: "DELETE",
      });
      if (handleUnauthorized(res)) return;
      if (!res.ok) {
        setNotice({ kind: "error", text: await failMessage(res, t("deleteFailed")) });
        return;
      }
      setNotice({ kind: "success", text: t("deleted") });
      await fetchSubscribers();
    } catch {
      setNotice({ kind: "error", text: t("networkError") });
    } finally {
      setDeleteTarget(null);
    }
  };

  const openEdit = (sub: Subscriber) => {
    setEditTarget(sub);
    setFormOpen(true);
    setFormError("");
  };

  const openAdd = () => {
    setEditTarget(null);
    setFormOpen(true);
    setFormError("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("subscribers")}</h1>
        <Button size="sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1.5" />
          {t("add")}
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("searchSubscribers")}
            aria-label={t("searchSubscribers")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAll")}</SelectItem>
            <SelectItem value="true">{t("active")}</SelectItem>
            <SelectItem value="false">{t("inactive")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm",
            notice.kind === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
          )}
        >
          <span>{notice.text}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setNotice(null)}
            aria-label={t("dismiss")}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          {tc("loading")}
        </div>
      ) : loadError ? (
        <Card className="border-destructive/40">
          <CardContent role="alert" className="p-8 text-center space-y-4">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                fetchSubscribers();
              }}
            >
              <RotateCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
              {tc("retry")}
            </Button>
          </CardContent>
        </Card>
      ) : subscribers.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            {t("noSubscribers")}
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium">{t("colNameOrg")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colEmail")}</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">{t("colCategories")}</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">{t("colLang")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("colStatus")}</th>
                  <th className="px-4 py-3 w-10"><span className="sr-only">{t("actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((sub) => (
                  <tr key={sub.id} className="border-b border-border/30 hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{sub.name}</div>
                      {sub.organization && (
                        <div className="text-xs text-muted-foreground">{sub.organization}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{sub.email}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(sub.categories || []).slice(0, 3).map((cat) => (
                          <Badge key={cat} variant="secondary" className="text-xs">
                            {categoryLabel(cat, locale, t("allCategories"))}
                          </Badge>
                        ))}
                        {(sub.categories || []).length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{sub.categories.length - 3}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <Badge variant="outline" className="text-xs">
                        {sub.language?.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 text-xs ${sub.is_active ? "text-green-500" : "text-muted-foreground"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sub.is_active ? "bg-green-500" : "bg-muted-foreground"}`} />
                        {sub.is_active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("actions")}>
                            <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(sub)}>
                            <Pencil className="w-3.5 h-3.5 mr-2" />
                            {t("edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleActive(sub)}>
                            <Power className="w-3.5 h-3.5 mr-2" />
                            {sub.is_active ? t("deactivate") : t("reactivate")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteTarget(sub)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            {t("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <SubscriberFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
        subscriber={editTarget}
        onSave={handleSave}
        saving={saving}
        error={formError}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.rich("deleteConfirm", {
              email: deleteTarget?.email ?? "",
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubscriberFormDialog({
  open,
  onOpenChange,
  subscriber,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriber: Subscriber | null;
  onSave: (formData: FormData) => void;
  saving: boolean;
  error: string;
}) {
  const isEdit = !!subscriber;
  const t = useTranslations("admin");
  const locale = useLocale();
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["all"]);

  useEffect(() => {
    if (subscriber) {
      setSelectedCategories(subscriber.categories || ["all"]);
    } else {
      setSelectedCategories(["all"]);
    }
  }, [subscriber, open]);

  const toggleCategory = (cat: string) => {
    if (cat === "all") {
      setSelectedCategories(["all"]);
      return;
    }
    setSelectedCategories((prev) => {
      const without = prev.filter((c) => c !== "all" && c !== cat);
      if (prev.includes(cat)) {
        return without.length === 0 ? ["all"] : without;
      }
      return [...without, cat];
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("categories", selectedCategories.join(","));
            onSave(fd);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">{t("fieldName")} *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={subscriber?.name || ""}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organization">{t("fieldOrganization")}</Label>
            <Input
              id="organization"
              name="organization"
              defaultValue={subscriber?.organization || ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("colEmail")} *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={subscriber?.email || ""}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>{t("colCategories")} *</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CATEGORIES.map((cat) => {
                const isSelected = selectedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {categoryLabel(cat, locale, t("allCategories"))}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="language">{t("fieldLanguage")}</Label>
            <Select name="language" defaultValue={subscriber?.language || "ko"}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ko">{t("langKo")}</SelectItem>
                <SelectItem value="en">{t("langEn")}</SelectItem>
                <SelectItem value="zh">{t("langZh")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              {isEdit ? t("save") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
