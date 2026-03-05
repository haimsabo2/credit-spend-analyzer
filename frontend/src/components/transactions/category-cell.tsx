import { useState } from "react"
import type { TransactionRead } from "@/types/api"
import { useCategories } from "@/hooks/use-categories"
import { useCategorize } from "@/hooks/use-categorize"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

interface Props {
  transaction: TransactionRead
}

export function CategoryCell({ transaction }: Props) {
  const { data: categories } = useCategories()
  const categorize = useCategorize()
  const [pendingCategoryId, setPendingCategoryId] = useState<number | null>(null)
  const [createRule, setCreateRule] = useState(false)
  const [open, setOpen] = useState(false)

  const currentValue = transaction.category_id != null ? String(transaction.category_id) : ""

  function handleSelect(value: string) {
    const catId = Number(value)
    setPendingCategoryId(catId)
    setCreateRule(false)
    setOpen(true)
  }

  function handleConfirm() {
    if (pendingCategoryId == null) return
    setOpen(false)
    categorize.mutate({
      txnId: transaction.id,
      body: {
        category_id: pendingCategoryId,
        create_rule: createRule,
        rule_match_type: createRule ? "merchant_key" : undefined,
        rule_pattern: createRule ? transaction.description : undefined,
      },
    })
    setPendingCategoryId(null)
  }

  function handleCancel() {
    setOpen(false)
    setPendingCategoryId(null)
  }

  if (categorize.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Saving...</span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <Select value={currentValue} onValueChange={handleSelect}>
            <SelectTrigger size="sm" className="h-7 w-36 text-xs">
              <SelectValue placeholder="Uncategorized" />
            </SelectTrigger>
            <SelectContent>
              {categories?.map((cat) => (
                <SelectItem key={cat.id} value={String(cat.id)}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-3 p-3" side="bottom" align="start">
        <div className="flex items-start gap-2">
          <Checkbox
            id={`rule-${transaction.id}`}
            checked={createRule}
            onCheckedChange={(v) => setCreateRule(v === true)}
          />
          <label
            htmlFor={`rule-${transaction.id}`}
            className="text-xs leading-tight text-muted-foreground"
          >
            Create rule for <span className="font-medium text-foreground">"{transaction.description}"</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleConfirm}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
