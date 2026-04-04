import { useTranslation } from "react-i18next"
import type { TransactionRead } from "@/types/api"
import { useSubcategories } from "@/hooks/use-subcategories"
import { usePatchTransactionSubcategory } from "@/hooks/use-patch-transaction-subcategory"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"

interface Props {
  transaction: TransactionRead
}

export function SubcategoryCell({ transaction }: Props) {
  const { t } = useTranslation()
  const cid = transaction.category_id
  const { data: subs, isLoading } = useSubcategories(cid ?? undefined)
  const patch = usePatchTransactionSubcategory()

  const current =
    transaction.subcategory_id != null ? String(transaction.subcategory_id) : ""

  function handleValueChange(value: string) {
    const subId = value === "__none__" ? null : Number(value)
    if (subId === transaction.subcategory_id) return
    patch.mutate({ transactionId: transaction.id, subcategoryId: subId })
  }

  if (cid == null) {
    return (
      <span className="text-muted-foreground text-xs" title={t("subcategories.needCategoryFirst")}>
        —
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    )
  }

  if (patch.isPending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t("transactionsTable.categorySaving")}</span>
      </div>
    )
  }

  return (
    <Select value={current || "__none__"} onValueChange={handleValueChange}>
      <SelectTrigger size="sm" className="h-7 w-32 text-xs">
        <SelectValue placeholder={t("subcategories.none")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{t("subcategories.none")}</SelectItem>
        {subs?.map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
