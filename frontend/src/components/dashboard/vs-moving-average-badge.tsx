import {
  computeVsPeriodAverage,
  deviationFromAverageColorClass,
  formatPctVsAverage,
  roundToHundreds,
} from "@/utils/moving-average"

type Props = {
  amount: number
  yearTotal: number
  monthsWithData: number
  className?: string
}

export function VsMovingAverageBadge({ amount, yearTotal, monthsWithData, className = "" }: Props) {
  const result = computeVsPeriodAverage(amount, yearTotal, monthsWithData)
  if (!result) return null

  return (
    <span
      className={`inline-block text-[10px] leading-tight tabular-nums ${deviationFromAverageColorClass(result.pct)} ${className}`}
      title={`${roundToHundreds(result.average)}`}
    >
      {formatPctVsAverage(result.pct)}
    </span>
  )
}
