import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { listCategories, listSubcategories, createSubcategory, deleteSubcategory } from "@/api/categories"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getApiErrorToastDescription } from "@/lib/api-client"
import { toast } from "sonner"
import { Loader2, Trash2 } from "lucide-react"

export function SubcategoryManageDialog() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [categoryId, setCategoryId] = useState<string>("")
  const [newName, setNewName] = useState("")

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
    enabled: open,
  })

  const cid = categoryId ? Number(categoryId) : 0
  const { data: subs, isLoading } = useQuery({
    queryKey: ["subcategories", cid],
    queryFn: () => listSubcategories(cid),
    enabled: open && cid > 0,
  })

  const addMut = useMutation({
    mutationFn: () => createSubcategory(cid, newName.trim()),
    onSuccess() {
      setNewName("")
      qc.invalidateQueries({ queryKey: ["subcategories", cid] })
      toast.success(t("subcategories.added"))
    },
    onError(err) {
      toast.error(t("subcategories.addFailed"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: number) => deleteSubcategory(id),
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["subcategories", cid] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
      toast.success(t("subcategories.deleted"))
    },
    onError(err) {
      toast.error(t("subcategories.deleteFailed"), {
        description: getApiErrorToastDescription(err),
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 text-xs">
          {t("subcategories.manageButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("subcategories.manageTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">{t("subcategories.pickCategory")}</p>
            <Select value={categoryId || "__none__"} onValueChange={(v) => setCategoryId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("transactionsTable.filterCategoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("transactionsTable.allCategories")}</SelectItem>
                {categories?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {cid > 0 && (
            <>
              <div className="flex gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("subcategories.newNamePlaceholder")}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!newName.trim() || addMut.isPending}
                  onClick={() => addMut.mutate()}
                >
                  {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("subcategories.add")}
                </Button>
              </div>

              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {isLoading ? (
                  <li className="text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </li>
                ) : !subs?.length ? (
                  <li className="text-muted-foreground">{t("subcategories.emptyList")}</li>
                ) : (
                  subs.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-0.5">
                      <span>{s.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive"
                        disabled={delMut.isPending}
                        onClick={() => delMut.mutate(s.id)}
                        aria-label={t("subcategories.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
