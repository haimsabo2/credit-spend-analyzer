import { useTranslation } from "react-i18next"
import type { TransactionRead } from "@/types/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useUpdateSpendPattern } from "@/hooks/use-update-spend-pattern"
import { Loader2, UserRound } from "lucide-react"

const PATTERNS = ["unknown", "recurring", "one_time"] as const

interface Props {
  transaction: TransactionRead
}

export function SpendPatternCell({ transaction }: Props) {
  const { t } = useTranslation()
  const mutation = useUpdateSpendPattern()
  const value = transaction.spend_pattern ?? "unknown"
  const busy = mutation.isPending && mutation.variables?.txnId === transaction.id

  function label(p: (typeof PATTERNS)[number]) {
    if (p === "recurring") return t("transactionsTable.recurring")
    if (p === "one_time") return t("transactionsTable.oneTime")
    return t("transactionsTable.unknown")
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={value}
        disabled={busy}
        onValueChange={(v) => {
          if (v === value) return
          mutation.mutate({ txnId: transaction.id, spend_pattern: v })
        }}
      >
        <SelectTrigger
          size="sm"
          className="h-7 w-[9.5rem] text-xs"
          title={
            transaction.spend_pattern_user_set ? t("transactionsTable.userLockedTitle") : undefined
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PATTERNS.map((p) => (
            <SelectItem key={p} value={p} className="text-xs">
              {label(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : transaction.spend_pattern_user_set ? (
        <UserRound
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-label={t("transactionsTable.userLockedTitle")}
        />
      ) : null}
    </div>
  )
}
