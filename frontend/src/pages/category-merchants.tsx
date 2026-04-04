import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, ArrowRightLeft } from "lucide-react"
import { listCategories, listSubcategories } from "@/api/categories"
import {
  approveMerchantGroup,
  categorizeTransaction,
  listMerchantGroups,
  setMerchantGroupSubcategory,
} from "@/api/transactions"
import type { MerchantGroupRow } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/utils/format"
import { getApiErrorToastDescription } from "@/lib/api-client"
import { toast } from "sonner"

const UNCATEGORIZED_VALUE = "__uncategorized__"
const SUB_ALL = "__sub_all__"
const SUB_NONE = "__sub_none__"
const SUB_NONE_TARGET = "__target_sub_none__"

export default function CategoryMerchantsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [categoryValue, setCategoryValue] = useState<string>("")
  const [subFilter, setSubFilter] = useState<string>(SUB_ALL)
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const limit = 100

  const [dialogRow, setDialogRow] = useState<MerchantGroupRow | null>(null)
  const [targetCategoryId, setTargetCategoryId] = useState<string>("")
  const [targetSubId, setTargetSubId] = useState<string>(SUB_NONE_TARGET)

  const { data: categories = [], isLoading: catLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  })

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name, "he")),
    [categories],
  )

  const selectedNumericCategoryId =
    categoryValue && categoryValue !== UNCATEGORIZED_VALUE
      ? Number(categoryValue)
      : null
  const isUncategorized = categoryValue === UNCATEGORIZED_VALUE

  const { data: subcategories = [] } = useQuery({
    queryKey: ["subcategories", selectedNumericCategoryId],
    queryFn: () => listSubcategories(selectedNumericCategoryId as number),
    enabled: selectedNumericCategoryId != null && Number.isFinite(selectedNumericCategoryId),
  })

  const subNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const s of subcategories) m.set(s.id, s.name)
    return m
  }, [subcategories])

  const { data: targetSubs = [] } = useQuery({
    queryKey: ["subcategories", targetCategoryId],
    queryFn: () => listSubcategories(Number(targetCategoryId)),
    enabled:
      dialogRow != null &&
      targetCategoryId !== "" &&
      Number.isFinite(Number(targetCategoryId)),
  })

  const groupParams = useMemo(() => {
    const q = search.trim() || undefined
    if (isUncategorized) {
      return {
        uncategorized_only: true as const,
        q,
        limit,
        offset,
      }
    }
    if (selectedNumericCategoryId == null) return null
    const base = {
      category_id: selectedNumericCategoryId,
      q,
      limit,
      offset,
    }
    if (subFilter === SUB_NONE) {
      return { ...base, missing_subcategory: true as const }
    }
    if (subFilter !== SUB_ALL && Number.isFinite(Number(subFilter))) {
      return { ...base, subcategory_id: Number(subFilter) }
    }
    return base
  }, [
    isUncategorized,
    selectedNumericCategoryId,
    subFilter,
    search,
    limit,
    offset,
  ])

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ["merchant-groups", "by-category", groupParams],
    queryFn: () => listMerchantGroups(groupParams!),
    enabled: groupParams != null,
  })

  const moveMut = useMutation({
    mutationFn: async ({
      repId,
      displayDescription,
      targetCatId,
      targetSub,
    }: {
      repId: number
      displayDescription: string
      targetCatId: number
      targetSub: number | null
    }) => {
      await categorizeTransaction(repId, {
        category_id: targetCatId,
        rule_pattern: displayDescription,
      })
      if (targetSub != null) {
        await approveMerchantGroup({ transaction_id: repId })
        await setMerchantGroupSubcategory({
          transaction_id: repId,
          subcategory_id: targetSub,
        })
      }
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["merchant-groups"] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
      qc.invalidateQueries({ queryKey: ["needs-review"] })
      toast.success(t("categoryMerchants.moveSuccess"))
      setDialogRow(null)
    },
    onError(err) {
      toast.error(t("categoryMerchants.moveError"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })

  function openDialog(row: MerchantGroupRow) {
    setDialogRow(row)
    if (row.category_id != null) {
      const other = sortedCategories.find((c) => c.id !== row.category_id)
      setTargetCategoryId(String(other?.id ?? row.category_id))
    } else {
      const first = sortedCategories[0]
      setTargetCategoryId(first != null ? String(first.id) : "")
    }
    setTargetSubId(SUB_NONE_TARGET)
  }

  function submitMove() {
    if (!dialogRow || !targetCategoryId) return
    const tid = Number(targetCategoryId)
    if (!Number.isFinite(tid)) return
    const sub =
      targetSubId === SUB_NONE_TARGET || targetSubId === ""
        ? null
        : Number(targetSubId)
    moveMut.mutate({
      repId: dialogRow.representative_transaction_id,
      displayDescription: dialogRow.display_description,
      targetCatId: tid,
      targetSub: sub != null && Number.isFinite(sub) ? sub : null,
    })
  }

  const hasSelection = categoryValue !== ""

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("categoryMerchants.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("categoryMerchants.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("categoryMerchants.filtersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="min-w-[12rem] flex-1 space-y-2">
            <span className="text-muted-foreground text-xs font-medium">
              {t("categoryMerchants.categoryLabel")}
            </span>
            {catLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select
                value={categoryValue || undefined}
                onValueChange={(v) => {
                  setCategoryValue(v)
                  setSubFilter(SUB_ALL)
                  setOffset(0)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("categoryMerchants.pickCategory")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCATEGORIZED_VALUE}>
                    {t("categoryMerchants.uncategorized")}
                  </SelectItem>
                  {sortedCategories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {hasSelection && !isUncategorized && (
            <div className="min-w-[12rem] flex-1 space-y-2">
              <span className="text-muted-foreground text-xs font-medium">
                {t("categoryMerchants.subcategoryFilter")}
              </span>
              <Select
                value={subFilter}
                onValueChange={(v) => {
                  setSubFilter(v)
                  setOffset(0)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SUB_ALL}>{t("categoryMerchants.subAll")}</SelectItem>
                  <SelectItem value={SUB_NONE}>{t("categoryMerchants.subMissing")}</SelectItem>
                  {subcategories.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="min-w-[10rem] flex-[2] space-y-2">
            <span className="text-muted-foreground text-xs font-medium">
              {t("categoryMerchants.search")}
            </span>
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setOffset(0)
              }}
              placeholder={t("categoryMerchants.searchPlaceholder")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("categoryMerchants.tableTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasSelection ? (
            <p className="text-muted-foreground text-sm">{t("categoryMerchants.pickCategoryHint")}</p>
          ) : groupsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("categoryMerchants.loading")}
            </div>
          ) : !groupsData?.items.length ? (
            <p className="text-muted-foreground text-sm">{t("categoryMerchants.empty")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("categoryMerchants.colMerchant")}</TableHead>
                    <TableHead className="w-24 text-end">{t("categoryMerchants.colCount")}</TableHead>
                    <TableHead className="w-32 text-end">{t("categoryMerchants.colTotal")}</TableHead>
                    {!isUncategorized && (
                      <TableHead className="min-w-[8rem]">
                        {t("categoryMerchants.colSubcategory")}
                      </TableHead>
                    )}
                    <TableHead className="min-w-[8rem]">{t("categoryMerchants.colSpendGroup")}</TableHead>
                    <TableHead className="w-28">{t("categoryMerchants.colAction")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupsData.items.map((row) => (
                    <TableRow key={row.pattern_key}>
                      <TableCell className="max-w-[20rem] truncate font-medium" title={row.display_description}>
                        {row.display_description}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{row.occurrence_count}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {formatCurrency(row.total_amount)}
                      </TableCell>
                      {!isUncategorized && (
                        <TableCell className="text-muted-foreground text-sm">
                          {row.subcategory_id != null
                            ? subNameById.get(row.subcategory_id) ?? `#${row.subcategory_id}`
                            : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground text-sm">
                        {row.spend_group_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => openDialog(row)}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                          {t("categoryMerchants.move")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {t("categoryMerchants.showing", {
                    from: offset + 1,
                    to: offset + groupsData.items.length,
                    total: groupsData.total,
                  })}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  >
                    {t("categoryMerchants.prev")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={offset + groupsData.items.length >= groupsData.total}
                    onClick={() => setOffset((o) => o + limit)}
                  >
                    {t("categoryMerchants.next")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogRow != null} onOpenChange={(o) => !o && setDialogRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("categoryMerchants.dialogTitle")}</DialogTitle>
          </DialogHeader>
          {dialogRow && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{dialogRow.display_description}</span>
                {" · "}
                {t("categoryMerchants.dialogOccurrences", { count: dialogRow.occurrence_count })}
              </p>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("categoryMerchants.targetCategory")}
                </span>
                <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("categoryMerchants.pickCategory")} />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedCategories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("categoryMerchants.targetSubcategory")}
                </span>
                <Select value={targetSubId} onValueChange={setTargetSubId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SUB_NONE_TARGET}>{t("categoryMerchants.subNoneTarget")}</SelectItem>
                    {targetSubs.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDialogRow(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!targetCategoryId || moveMut.isPending}
              onClick={submitMove}
            >
              {moveMut.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t("categoryMerchants.applyMove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
