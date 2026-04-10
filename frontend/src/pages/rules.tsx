import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api-client"
import { useCategories } from "@/hooks/use-categories"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Settings2, Plus, Pencil, Trash2, Loader2, Inbox } from "lucide-react"
import { toast } from "sonner"
import type { RuleRead, RuleCreateRequest, RuleUpdateRequest } from "@/types/api"

function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => api.get<RuleRead[]>("/api/rules"),
  })
}

function useCreateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: RuleCreateRequest) => api.post<RuleRead>("/api/rules", body),
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}

function useUpdateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RuleUpdateRequest }) =>
      api.put<RuleRead>(`/api/rules/${id}`, body),
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}

function useDeleteRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/rules/${id}`),
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["rules"] })
    },
  })
}

const MATCH_TYPES = [
  { value: "contains", label: "Contains" },
  { value: "regex", label: "Regex" },
  { value: "merchant_key", label: "Merchant key" },
]

interface RuleFormData {
  category_id: string
  pattern: string
  match_type: string
  priority: string
  active: boolean
  card_label_filter: string
}

const EMPTY_FORM: RuleFormData = {
  category_id: "",
  pattern: "",
  match_type: "contains",
  priority: "100",
  active: true,
  card_label_filter: "",
}

export default function RulesPage() {
  const { t } = useTranslation()
  const rules = useRules()
  const categories = useCategories()
  const createRule = useCreateRule()
  const updateRule = useUpdateRule()
  const deleteRule = useDeleteRule()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RuleRead | null>(null)
  const [form, setForm] = useState<RuleFormData>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<RuleRead | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const displayRules = showInactive
    ? rules.data
    : rules.data?.filter((r) => r.active)

  function openCreate() {
    setEditingRule(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(rule: RuleRead) {
    setEditingRule(rule)
    setForm({
      category_id: String(rule.category_id),
      pattern: rule.pattern,
      match_type: rule.match_type,
      priority: String(rule.priority),
      active: rule.active,
      card_label_filter: rule.card_label_filter ?? "",
    })
    setDialogOpen(true)
  }

  function handleSave() {
    const categoryId = Number(form.category_id)
    const priority = Number(form.priority)
    if (!categoryId || !form.pattern.trim()) return

    if (editingRule) {
      updateRule.mutate(
        {
          id: editingRule.id,
          body: {
            category_id: categoryId,
            pattern: form.pattern.trim(),
            match_type: form.match_type,
            priority: Number.isFinite(priority) ? priority : 100,
            active: form.active,
            card_label_filter: form.card_label_filter.trim() || null,
          },
        },
        {
          onSuccess() {
            toast.success(t("rules.updated", "Rule updated"))
            setDialogOpen(false)
          },
          onError() {
            toast.error(t("rules.updateError", "Could not update rule"))
          },
        },
      )
    } else {
      createRule.mutate(
        {
          category_id: categoryId,
          pattern: form.pattern.trim(),
          match_type: form.match_type,
          priority: Number.isFinite(priority) ? priority : 100,
          active: form.active,
          card_label_filter: form.card_label_filter.trim() || null,
        },
        {
          onSuccess() {
            toast.success(t("rules.created", "Rule created"))
            setDialogOpen(false)
          },
          onError() {
            toast.error(t("rules.createError", "Could not create rule"))
          },
        },
      )
    }
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteRule.mutate(deleteTarget.id, {
      onSuccess() {
        toast.success(t("rules.deleted", "Rule deleted"))
        setDeleteTarget(null)
      },
      onError() {
        toast.error(t("rules.deleteError", "Could not delete rule"))
      },
    })
  }

  function handleToggleActive(rule: RuleRead) {
    updateRule.mutate({
      id: rule.id,
      body: { active: !rule.active },
    })
  }

  const saving = createRule.isPending || updateRule.isPending

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("rules.title", "Classification Rules")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("rules.subtitle", "Manage automatic transaction categorization rules")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            {t("rules.showInactive", "Show inactive")}
          </label>
          <Button className="gap-1.5" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("rules.createRule", "New Rule")}
          </Button>
        </div>
      </div>

      {rules.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !displayRules?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold">{t("rules.empty", "No rules")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("rules.emptyHint", "Create rules to automatically categorize transactions by pattern matching.")}
            </p>
            <Button variant="outline" className="mt-2 gap-1.5" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("rules.createFirst", "Create your first rule")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-5 w-5 text-muted-foreground" />
              {t("rules.tableTitle", "Rules")}
              <Badge variant="secondary" className="text-xs">{displayRules.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("rules.colPattern", "Pattern")}</TableHead>
                    <TableHead>{t("rules.colType", "Match type")}</TableHead>
                    <TableHead>{t("rules.colCategory", "Category")}</TableHead>
                    <TableHead className="text-center">
                      {t("rules.colPriority", "Priority")}
                    </TableHead>
                    <TableHead>{t("rules.colCard", "Card filter")}</TableHead>
                    <TableHead className="text-center">
                      {t("rules.colActive", "Active")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("rules.colActions", "Actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRules.map((rule) => (
                    <TableRow
                      key={rule.id}
                      className={!rule.active ? "opacity-50" : undefined}
                    >
                      <TableCell className="max-w-[200px] truncate font-mono text-xs">
                        {rule.pattern}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {rule.match_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{rule.category_name}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {rule.priority}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {rule.card_label_filter || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={rule.active}
                          onCheckedChange={() => handleToggleActive(rule)}
                        />
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEdit(rule)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(rule)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingRule
                ? t("rules.editTitle", "Edit Rule")
                : t("rules.createTitle", "Create Rule")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("rules.colPattern", "Pattern")}</label>
              <Input
                value={form.pattern}
                onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                placeholder={t("rules.patternPlaceholder", 'e.g. "supermarket" or regex')}
                className="font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("rules.colType", "Match type")}</label>
                <Select value={form.match_type} onValueChange={(v) => setForm({ ...form, match_type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATCH_TYPES.map((mt) => (
                      <SelectItem key={mt.value} value={mt.value}>
                        {mt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("rules.colPriority", "Priority")}</label>
                <Input
                  type="number"
                  min={1}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("rules.colCategory", "Category")}</label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t("review.chooseCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.data?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("rules.cardFilter", "Card filter (optional)")}
              </label>
              <Input
                value={form.card_label_filter}
                onChange={(e) => setForm({ ...form, card_label_filter: e.target.value })}
                placeholder={t("rules.cardFilterPlaceholder", "Leave empty for all cards")}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={form.active}
                onCheckedChange={(checked) => setForm({ ...form, active: checked })}
              />
              <label className="text-sm">{t("rules.colActive", "Active")}</label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.category_id || !form.pattern.trim() || saving}
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {editingRule ? t("rules.save", "Save") : t("rules.create", "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rules.deleteTitle", "Delete rule?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rules.deleteConfirm", 'This will permanently delete the rule "{{pattern}}". Existing transactions will not be uncategorized.')}
              {deleteTarget && (
                <span className="mt-1 block font-mono text-xs">{deleteTarget.pattern}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRule.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={deleteRule.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteRule.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("rules.deleteAction", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
