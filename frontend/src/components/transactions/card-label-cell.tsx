import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import type { TransactionRead } from "@/types/api"
import { patchTransactionCardLabel } from "@/api/transactions"
import { useMonthStore } from "@/stores/use-month-store"
import { useCardLabels } from "@/hooks/use-card-labels"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

const NO_CARD_VALUE = "___no_card___"
const CUSTOM_VALUE = "___custom_card___"

interface Props {
  transaction: TransactionRead
}

export function CardLabelCell({ transaction }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const month = useMonthStore((s) => s.month)
  const { data: knownLabels = [] } = useCardLabels(month)
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState("")

  const options = useMemo(() => {
    const s = new Set(knownLabels)
    const cur = transaction.card_label?.trim()
    if (cur) s.add(cur)
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [knownLabels, transaction.card_label])

  const mutation = useMutation({
    mutationFn: (card_label: string | null) =>
      patchTransactionCardLabel(transaction.id, card_label),
    onSuccess() {
      setCustomMode(false)
      setCustomText("")
      qc.invalidateQueries({ queryKey: ["transactions"] })
      qc.invalidateQueries({ queryKey: ["card-labels"] })
      qc.invalidateQueries({ queryKey: ["card-trends"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
      toast.success(t("transactionsTable.cardLabelUpdated"))
    },
    onError() {
      toast.error(t("transactionsTable.cardLabelUpdateError"))
    },
  })

  const busy = mutation.isPending
  const current = transaction.card_label?.trim() ?? ""
  const selectValue = customMode ? CUSTOM_VALUE : current || NO_CARD_VALUE

  function applyCustom() {
    const v = customText.trim()
    mutation.mutate(v || null)
  }

  function handleSelectChange(value: string) {
    if (value === CUSTOM_VALUE) {
      setCustomMode(true)
      setCustomText(current)
      return
    }
    setCustomMode(false)
    setCustomText("")
    if (value === NO_CARD_VALUE) {
      if (!current) return
      mutation.mutate(null)
      return
    }
    if (value === current) return
    mutation.mutate(value)
  }

  if (busy) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{t("transactionsTable.cardLabelSaving")}</span>
      </div>
    )
  }

  return (
    <div className="flex max-w-[min(100%,10rem)] flex-col gap-1">
      <Select value={selectValue} onValueChange={handleSelectChange}>
        <SelectTrigger size="sm" className="h-7 w-full max-w-40 text-xs">
          <SelectValue
            placeholder={t("transactionsTable.cardLabelPlaceholder")}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_CARD_VALUE}>{t("transactionsTable.cardLabelClear")}</SelectItem>
          {options.map((label) => (
            <SelectItem key={label} value={label}>
              {label.length > 28 ? `${label.slice(0, 28)}…` : label}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>{t("transactionsTable.cardLabelCustom")}</SelectItem>
        </SelectContent>
      </Select>
      {customMode ? (
        <div className="flex flex-wrap items-center gap-1">
          <Input
            className="h-7 min-w-0 flex-1 text-xs"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder={t("transactionsTable.cardLabelCustomPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyCustom()
            }}
          />
          <Button type="button" size="sm" className="h-7 text-[10px]" onClick={applyCustom}>
            {t("transactionsTable.cardLabelApply")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
