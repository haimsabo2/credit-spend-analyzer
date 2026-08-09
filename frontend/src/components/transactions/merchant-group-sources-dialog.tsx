import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { TransactionRead } from "@/types/api"
import { formatCurrency } from "@/lib/format"
import { formatTransactionTableDate } from "@/utils/format"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  merchantLabel: string
  sources: TransactionRead[]
  isLoading: boolean
  onSelect: (txn: TransactionRead) => void
}

function sourceSummary(txn: TransactionRead, t: ReturnType<typeof useTranslation>["t"]): string {
  const file = txn.source_upload_original_filename?.trim()
  const row = txn.source_row_1based
  if (file && row != null) return t("transactionSource.hoverTitle", { file, row })
  if (file) return t("transactionSource.hoverTitleNoRow", { file })
  if (row != null) return t("transactionSource.hoverTitleNoFile", { row })
  return t("transactionSource.open")
}

export function MerchantGroupSourcesDialog({
  open,
  onOpenChange,
  merchantLabel,
  sources,
  isLoading,
  onSelect,
}: Props) {
  const { t } = useTranslation()

  const withSource = sources.filter(
    (s) => s.source_row_1based != null || s.source_trace_upload_id != null,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("merchantGroups.sourcesTitle")}</DialogTitle>
          <DialogDescription>
            {t("merchantGroups.sourcesDescription", { name: merchantLabel, count: withSource.length })}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : withSource.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("merchantGroups.sourcesEmpty")}</p>
        ) : (
          <ul className="max-h-[min(60vh,420px)] space-y-2 overflow-y-auto">
            {withSource.map((txn) => (
              <li key={txn.id}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full flex-col items-start gap-1 px-3 py-2 text-start whitespace-normal"
                  onClick={() => onSelect(txn)}
                >
                  <span className="flex w-full flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium tabular-nums">
                      {formatCurrency(txn.amount)}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {txn.posted_at ? formatTransactionTableDate(txn.posted_at) : "—"}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs leading-snug">{sourceSummary(txn, t)}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
