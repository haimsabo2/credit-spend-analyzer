import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CategoryMonthlyRow } from "@/api/types"
import {
  CategoryYearSmallMultiples,
  computeCategoryYearSharedYMax,
} from "@/components/dashboard/category-year-small-multiples"

function useCarouselPageSize(): number {
  const [n, setN] = useState(3)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)")
    const upd = () => setN(mq.matches ? 3 : 1)
    upd()
    mq.addEventListener("change", upd)
    return () => mq.removeEventListener("change", upd)
  }, [])
  return n
}

export interface CategoryYearCarouselProps {
  rows: CategoryMonthlyRow[]
  monthLabels: string[]
  currency: string
  currencySymbol: string
  onPanelClick?: (row: CategoryMonthlyRow) => void
}

export function CategoryYearCarousel({
  rows,
  monthLabels,
  currency,
  currencySymbol,
  onPanelClick,
}: CategoryYearCarouselProps) {
  const { t } = useTranslation()
  const pageSize = useCarouselPageSize()
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const visibleRows = rows.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const sharedYMax = computeCategoryYearSharedYMax(rows)

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, totalPages - 1)))
  }, [totalPages])

  const goPrev = useCallback(() => {
    setPage((p) => Math.max(0, p - 1))
  }, [])
  const goNext = useCallback(() => {
    setPage((p) => Math.min(totalPages - 1, p + 1))
  }, [totalPages])

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="hidden shrink-0 self-center sm:inline-flex"
        disabled={safePage <= 0}
        onClick={goPrev}
        aria-label={t("dashboard.categoryCarouselPrev")}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-center gap-2 sm:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={safePage <= 0}
            onClick={goPrev}
            aria-label={t("dashboard.categoryCarouselPrev")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground min-w-[4rem] text-center text-xs tabular-nums">
            {t("dashboard.categoryCarouselPage", { current: safePage + 1, total: totalPages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={safePage >= totalPages - 1}
            onClick={goNext}
            aria-label={t("dashboard.categoryCarouselNext")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <CategoryYearSmallMultiples
          rows={visibleRows}
          monthLabels={monthLabels}
          currency={currency}
          currencySymbol={currencySymbol}
          sharedYMax={sharedYMax}
          onPanelClick={onPanelClick}
          layout="carousel"
        />
        <p className="text-muted-foreground hidden pt-1 text-center text-xs tabular-nums sm:block">
          {t("dashboard.categoryCarouselPage", { current: safePage + 1, total: totalPages })}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="hidden shrink-0 self-center sm:inline-flex"
        disabled={safePage >= totalPages - 1}
        onClick={goNext}
        aria-label={t("dashboard.categoryCarouselNext")}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
