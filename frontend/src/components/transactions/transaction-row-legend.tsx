import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

type LegendItem = {
  swatch: string
  labelKey: string
  dot?: boolean
}

const ROW_ITEMS: LegendItem[] = [
  { swatch: "bg-sky-500/25 border border-sky-500/40", labelKey: "transactionsTable.legendRecurring" },
  { swatch: "bg-violet-500/25 border border-violet-500/40", labelKey: "transactionsTable.legendOneTime" },
  {
    swatch: "border-s-2 border-s-amber-500/70 bg-amber-500/[0.08]",
    labelKey: "transactionsTable.legendCategoryConflict",
  },
  {
    swatch: "border-s-2 border-s-destructive bg-destructive/5",
    labelKey: "transactionsTable.legendAnomaly",
  },
]

const DOT_ITEMS: LegendItem[] = [
  { swatch: "bg-amber-500", labelKey: "transactionsTable.legendNeedsReview", dot: true },
  { swatch: "bg-emerald-500", labelKey: "transactionsTable.legendCategorized", dot: true },
]

function Swatch({ className, dot }: { className: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0",
        dot ? "h-2 w-2 rounded-full" : "h-3 w-5 rounded-sm",
        className,
      )}
      aria-hidden
    />
  )
}

type Props = {
  showGroupHeader?: boolean
  className?: string
}

export function TransactionRowLegend({ showGroupHeader = false, className }: Props) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col gap-2 rounded-md border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground",
        className,
      )}
      role="note"
      aria-label={t("transactionsTable.legendTitle")}
    >
      <p className="font-medium text-foreground/80">{t("transactionsTable.legendTitle")}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {ROW_ITEMS.map((item) => (
          <li key={item.labelKey} className="flex items-center gap-1.5">
            <Swatch className={item.swatch} />
            <span>{t(item.labelKey)}</span>
          </li>
        ))}
        {showGroupHeader ? (
          <li className="flex items-center gap-1.5">
            <Swatch className="bg-muted/80 border border-border" />
            <span>{t("transactionsTable.legendGroupHeader")}</span>
          </li>
        ) : null}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 pt-2">
        {DOT_ITEMS.map((item) => (
          <li key={item.labelKey} className="flex items-center gap-1.5">
            <Swatch className={item.swatch} dot />
            <span>{t(item.labelKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
