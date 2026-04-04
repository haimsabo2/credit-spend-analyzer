import { useState } from "react"
import { NavLink } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { LayoutDashboard, Upload, CalendarDays, List, AlertCircle, CreditCard, Trash2, Loader2, Tags, LayoutList } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { api, getApiErrorToastDescription } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"

const links = [
  { to: "/", labelKey: "nav.dashboard" as const, icon: LayoutDashboard },
  { to: "/upload", labelKey: "nav.upload" as const, icon: Upload },
  { to: "/months", labelKey: "nav.months" as const, icon: CalendarDays },
  { to: "/transactions", labelKey: "nav.transactions" as const, icon: List },
  { to: "/review", labelKey: "nav.needsReview" as const, icon: AlertCircle },
  { to: "/merchant-spend-groups", labelKey: "nav.merchantSpendGroups" as const, icon: Tags },
  { to: "/categories/merchants", labelKey: "nav.categoryMerchants" as const, icon: LayoutList },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [clearing, setClearing] = useState(false)
  const [open, setOpen] = useState(false)

  async function handleClear() {
    setClearing(true)
    try {
      await api.del("/api/admin/reset")
      await qc.invalidateQueries()
      toast.success(t("sidebar.clearSuccess"))
      setOpen(false)
    } catch (err) {
      const desc = getApiErrorToastDescription(err)
      toast.error(t("sidebar.clearFailed"), desc ? { description: desc } : undefined)
    } finally {
      setClearing(false)
    }
  }

  return (
    <aside className="fixed inset-y-0 start-0 z-30 flex w-56 flex-col border-e bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <CreditCard className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">Spend Analyzer</span>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3">
        {links.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      <div className="border-t px-2 py-3">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sm font-medium text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {t("sidebar.clearAllData")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("sidebar.clearAllDataTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("sidebar.clearAllDataDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>{t("sidebar.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  handleClear()
                }}
                disabled={clearing}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {clearing && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
                {t("sidebar.deleteEverything")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </aside>
  )
}
