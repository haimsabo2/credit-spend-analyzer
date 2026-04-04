import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Line,
  LineChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  listMerchantSpendGroups,
  createMerchantSpendGroup,
  deleteMerchantSpendGroup,
  listGroupMembers,
  addGroupMember,
  removeGroupMember,
  getMerchantGroupSeries,
} from "@/api/merchantSpendGroups"
import { formatCurrency, formatMonthShort } from "@/utils/format"
import { getApiErrorToastDescription } from "@/lib/api-client"
import { toast } from "sonner"
import { Loader2, Trash2 } from "lucide-react"

const TRAILING = "__trail12__"

export default function MerchantSpendGroupsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newGroupName, setNewGroupName] = useState("")
  const [patternInput, setPatternInput] = useState("")
  const [chartScope, setChartScope] = useState<string>(() => String(new Date().getFullYear()))

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ["merchant-spend-groups"],
    queryFn: listMerchantSpendGroups,
  })

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["merchant-spend-groups", selectedId, "members"],
    queryFn: () => listGroupMembers(selectedId as number),
    enabled: selectedId != null && selectedId > 0,
  })

  const seriesScope = useMemo(() => {
    if (chartScope === TRAILING) return { trailingCalendarMonths: 12 as const }
    const y = Number(chartScope)
    return Number.isFinite(y) ? { year: y } : { year: new Date().getFullYear() }
  }, [chartScope])

  const { data: series, isLoading: seriesLoading } = useQuery({
    queryKey: ["merchant-group-series", selectedId, seriesScope],
    queryFn: () => getMerchantGroupSeries(selectedId as number, seriesScope),
    enabled: selectedId != null && selectedId > 0,
  })

  const chartRows = useMemo(() => {
    if (!series?.months.length) return []
    return series.months.map((ym, i) => ({
      label: formatMonthShort(ym),
      total: series.amounts[i] ?? 0,
    }))
  }, [series])

  const createMut = useMutation({
    mutationFn: () => createMerchantSpendGroup(newGroupName.trim()),
    onSuccess: (g) => {
      setNewGroupName("")
      setSelectedId(g.id)
      qc.invalidateQueries({ queryKey: ["merchant-spend-groups"] })
      toast.success(t("merchantSpendGroups.created"))
    },
    onError: (err) => {
      toast.error(t("merchantSpendGroups.createFailed"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })

  const deleteGroupMut = useMutation({
    mutationFn: deleteMerchantSpendGroup,
    onSuccess: () => {
      setSelectedId(null)
      qc.invalidateQueries({ queryKey: ["merchant-spend-groups"] })
      toast.success(t("merchantSpendGroups.deleted"))
    },
    onError: (err) => {
      toast.error(t("merchantSpendGroups.deleteFailed"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })

  const addMemberMut = useMutation({
    mutationFn: () => addGroupMember(selectedId as number, patternInput.trim()),
    onSuccess(res) {
      setPatternInput("")
      qc.invalidateQueries({ queryKey: ["merchant-spend-groups", selectedId, "members"] })
      qc.invalidateQueries({ queryKey: ["merchant-group-series"] })
      const n = res.added.length
      const blocked = res.blocked_other_group.length
      const skipped = res.skipped_already_in_this_group.length
      if (res.unmatched) {
        toast.error(t("merchantSpendGroups.memberNoMatch"))
      } else if (res.bulk) {
        if (n > 0) {
          toast.success(t("merchantSpendGroups.memberAddedBulk", { count: n }))
        }
        if (skipped > 0) {
          toast.message(t("merchantSpendGroups.memberSkippedInGroup", { count: skipped }))
        }
        if (blocked > 0) {
          toast.warning(t("merchantSpendGroups.memberBlockedOtherGroup", { count: blocked }))
        }
        if (n === 0 && !skipped && !blocked) {
          toast.error(t("merchantSpendGroups.memberNoMatch"))
        }
      } else if (n === 1) {
        toast.success(t("merchantSpendGroups.memberAdded"))
      }
    },
    onError: (err) => {
      toast.error(t("merchantSpendGroups.memberAddFailed"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })

  const removeMemberMut = useMutation({
    mutationFn: (memberId: number) => removeGroupMember(selectedId as number, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["merchant-spend-groups", selectedId, "members"] })
      qc.invalidateQueries({ queryKey: ["merchant-group-series"] })
      toast.success(t("merchantSpendGroups.memberRemoved"))
    },
    onError: (err) => {
      toast.error(t("merchantSpendGroups.memberRemoveFailed"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })

  const cy = new Date().getFullYear()
  const yearOptions = [cy + 1, cy, cy - 1, cy - 2, cy - 3]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("merchantSpendGroups.title")}</h1>
      <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
        {t("merchantSpendGroups.intro")}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("merchantSpendGroups.createGroup")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={t("merchantSpendGroups.groupNamePlaceholder")}
          />
          <Button
            type="button"
            disabled={!newGroupName.trim() || createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("merchantSpendGroups.create")}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("merchantSpendGroups.yourGroups")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {groupsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !groups?.length ? (
              <p className="text-muted-foreground text-sm">{t("merchantSpendGroups.noGroups")}</p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className={`truncate text-start hover:underline ${selectedId === g.id ? "font-semibold text-primary" : ""}`}
                      onClick={() => setSelectedId(g.id)}
                    >
                      {g.display_name}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive"
                      onClick={() => {
                        if (confirm(t("merchantSpendGroups.confirmDeleteGroup"))) {
                          deleteGroupMut.mutate(g.id)
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("merchantSpendGroups.membersTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedId ? (
              <p className="text-muted-foreground text-sm">{t("merchantSpendGroups.selectGroupHint")}</p>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">{t("merchantSpendGroups.patternHint")}</p>
                <div className="flex gap-2">
                  <Input
                    value={patternInput}
                    onChange={(e) => setPatternInput(e.target.value)}
                    placeholder={t("merchantSpendGroups.patternPlaceholder")}
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!patternInput.trim() || addMemberMut.isPending}
                    onClick={() => addMemberMut.mutate()}
                  >
                    {t("merchantSpendGroups.addMember")}
                  </Button>
                </div>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded border p-2 text-xs">
                  {membersLoading ? (
                    <li className="text-muted-foreground flex gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </li>
                  ) : !members?.length ? (
                    <li className="text-muted-foreground">{t("merchantSpendGroups.noMembers")}</li>
                  ) : (
                    members.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-0.5 font-mono">
                        <span className="truncate">{m.pattern_key}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => removeMemberMut.mutate(m.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedId ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{t("merchantSpendGroups.monthlyTrendTitle")}</CardTitle>
            <Select value={chartScope} onValueChange={setChartScope}>
              <SelectTrigger className="w-[11rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TRAILING}>{t("dashboard.trailing12Months")}</SelectItem>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="h-[280px] w-full">
            {seriesLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={44} />
                  <Tooltip
                    formatter={(v) => [
                      formatCurrency(Number(v ?? 0), "ILS"),
                      t("dashboard.monthTableSpend"),
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="var(--color-chart-2)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
