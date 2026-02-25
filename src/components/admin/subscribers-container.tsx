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
} from "lucide-react";
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

const CATEGORY_LABELS: Record<string, string> = {
  all: "All Categories",
  "ai-tech": "AI Tech",
  "ai-product": "AI Products",
  "ai-biz": "AI Business",
  politics: "Politics",
  economy: "Economy",
  society: "Society",
  culture: "Culture",
  tech: "IT/Science",
};

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

  const debouncedSearch = useDebounce(search, 300);

  const fetchSubscribers = useCallback(async () => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (activeFilter !== "all") params.set("active", activeFilter);
    const res = await fetch(`/api/admin/subscribers?${params}`);
    const data = await res.json();
    setSubscribers(data.data?.subscribers || []);
    setLoading(false);
  }, [debouncedSearch, activeFilter]);

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
        ? `/api/admin/subscribers/${editTarget.id}`
        : "/api/admin/subscribers";
      const method = editTarget ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error?.message || "Save failed");
        setSaving(false);
        return;
      }

      setFormOpen(false);
      setEditTarget(null);
      await fetchSubscribers();
    } catch {
      setFormError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (sub: Subscriber) => {
    await fetch(`/api/admin/subscribers/${sub.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !sub.is_active }),
    });
    await fetchSubscribers();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/admin/subscribers/${deleteTarget.id}`, {
      method: "DELETE",
    });
    setDeleteTarget(null);
    await fetchSubscribers();
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
        <h1 className="text-2xl font-bold">Subscribers</h1>
        <Button size="sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, org..."
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
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading...
        </div>
      ) : subscribers.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            No subscribers found.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium">Name / Org</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Categories</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Lang</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 w-10"></th>
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
                          <Badge key={cat} variant="secondary" className="text-[10px]">
                            {CATEGORY_LABELS[cat] || cat}
                          </Badge>
                        ))}
                        {(sub.categories || []).length > 3 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{sub.categories.length - 3}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px]">
                        {sub.language?.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 text-xs ${sub.is_active ? "text-green-500" : "text-muted-foreground"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sub.is_active ? "bg-green-500" : "bg-muted-foreground"}`} />
                        {sub.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(sub)}>
                            <Pencil className="w-3.5 h-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleActive(sub)}>
                            <Power className="w-3.5 h-3.5 mr-2" />
                            {sub.is_active ? "Deactivate" : "Reactivate"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteTarget(sub)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Delete
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
            <DialogTitle>Delete Subscriber</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <strong>{deleteTarget?.email}</strong>? This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
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
          <DialogTitle>{isEdit ? "Edit" : "Add"} Subscriber</DialogTitle>
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
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={subscriber?.name || ""}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organization">Organization</Label>
            <Input
              id="organization"
              name="organization"
              defaultValue={subscriber?.organization || ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={subscriber?.email || ""}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Categories *</Label>
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
                    {CATEGORY_LABELS[cat] || cat}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="language">Language</Label>
            <Select name="language" defaultValue={subscriber?.language || "ko"}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ko">Korean</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">Chinese</SelectItem>
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
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              {isEdit ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
