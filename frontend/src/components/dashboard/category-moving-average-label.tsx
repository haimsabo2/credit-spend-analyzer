import { useTranslation } from "react-i18next"
import { formatCurrency } from "@/utils/format"
import { categoryPeriodAverage, roundToHundreds } from "@/utils/moving-average"

type Props = {
  yearTotal: number
  monthsWithData: number
  currency: string
}

export function CategoryMovingAverageLabel({ yearTotal, monthsWithData, currency }: Props) {
  const { t } = useTranslation()
  const avg = categoryPeriodAverage(yearTotal, monthsWithData)
  if (avg == null) return null

  return (
    <span className="text-muted-foreground mt-0.5 block text-[10px] font-normal leading-tight tabular-nums">
      {t("dashboard.movingAvgAmount", {
        amount: formatCurrency(roundToHundreds(avg), currency),
      })}
    </span>
  )
}
