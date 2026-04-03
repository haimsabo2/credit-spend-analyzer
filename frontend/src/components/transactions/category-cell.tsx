import { useTranslation } from "react-i18next"
import type { TransactionRead } from "@/types/api"
import { useCategories } from "@/hooks/use-categories"
import { useCategorize } from "@/hooks/use-categorize"
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

export function CategoryCell({ transaction }: Props) {
  const { t } = useTranslation()
  const { data: categories } = useCategories()
  const categorize = useCategorize()

  const currentValue = transaction.category_id != null ? String(transaction.category_id) : ""

  function handleValueChange(value: string) {
    const catId = Number(value)
    if (transaction.category_id === catId) return
    categorize.mutate({
      txnId: transaction.id,
      body: { category_id: catId },
    })
  }

  if (categorize.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t("transactionsTable.categorySaving")}</span>
      </div>
    )
  }

  return (
    <div title={t("transactionsTable.categoryPropagateHint")}>
      <Select value={currentValue} onValueChange={handleValueChange}>
        <SelectTrigger size="sm" className="h-7 w-36 text-xs">
          <SelectValue placeholder={t("transactionsTable.uncategorized")} />
        </SelectTrigger>
        <SelectContent>
          {categories?.map((cat) => (
            <SelectItem key={cat.id} value={String(cat.id)}>
              {cat.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
