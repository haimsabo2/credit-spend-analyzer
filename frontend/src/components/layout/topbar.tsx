import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LanguageToggle } from "./language-toggle"
import { useMonthStore, formatMonthLabel } from "@/stores/use-month-store"
import { useUploads } from "@/hooks/use-uploads"
import { monthsWithDataFromUploads } from "@/utils/month"

export function Topbar() {
  const { t } = useTranslation()
  const month = useMonthStore((s) => s.month)
  const setMonth = useMonthStore((s) => s.setMonth)
  const uploads = useUploads()
  const options = useMemo(() => {
    const fromData = uploads.data ? monthsWithDataFromUploads(uploads.data) : []
    if (fromData.includes(month)) return fromData
    return [month, ...fromData].sort((a, b) => b.localeCompare(a))
  }, [uploads.data, month])

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-end gap-3 border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {t("topbar.statementMonth")}
        </span>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger
            className="h-8 w-[min(100%,11rem)] min-w-[9rem]"
            aria-label={t("topbar.statementMonth")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((m) => (
              <SelectItem key={m} value={m}>
                {formatMonthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <LanguageToggle />
    </header>
  )
}
