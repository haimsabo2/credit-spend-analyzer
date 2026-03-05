import type { ColumnDef } from "@tanstack/react-table"
import type { TransactionRead } from "@/types/api"
import { Badge } from "@/components/ui/badge"
import { CategoryCell } from "./category-cell"
import { formatCurrency } from "@/lib/format"
import { ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"

function SortHeader({ column, label }: { column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc" }; label: string }) {
  const sorted = column.getIsSorted()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 text-xs font-medium"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )
}

export const columns: ColumnDef<TransactionRead>[] = [
  {
    accessorKey: "posted_at",
    header: ({ column }) => <SortHeader column={column} label="Date" />,
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      if (!v) return <span className="text-muted-foreground">--</span>
      const d = new Date(v + "T00:00:00")
      return (
        <span className="tabular-nums">
          {d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
        </span>
      )
    },
    size: 90,
  },
  {
    accessorKey: "description",
    header: ({ column }) => <SortHeader column={column} label="Description" />,
    cell: ({ getValue }) => (
      <span className="block max-w-[260px] truncate" title={getValue<string>()}>
        {getValue<string>()}
      </span>
    ),
    size: 260,
  },
  {
    accessorKey: "amount",
    header: ({ column }) => <SortHeader column={column} label="Amount" />,
    cell: ({ getValue }) => (
      <span className="tabular-nums font-medium">{formatCurrency(getValue<number>())}</span>
    ),
    size: 100,
  },
  {
    accessorKey: "currency",
    header: "Cur",
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      return v ? (
        <Badge variant="outline" className="text-[10px]">
          {v}
        </Badge>
      ) : null
    },
    size: 60,
    enableSorting: false,
  },
  {
    accessorKey: "category_id",
    header: "Category",
    cell: ({ row }) => <CategoryCell transaction={row.original} />,
    size: 160,
    enableSorting: false,
  },
  {
    accessorKey: "card_label",
    header: "Card",
    cell: ({ getValue }) => (
      <span className="block max-w-[140px] truncate text-muted-foreground" title={getValue<string | null>() ?? ""}>
        {getValue<string | null>() ?? "--"}
      </span>
    ),
    size: 140,
    enableSorting: false,
  },
  {
    accessorKey: "section",
    header: "Section",
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      if (!v) return null
      return (
        <Badge variant="secondary" className="text-[10px]">
          {v}
        </Badge>
      )
    },
    size: 80,
    enableSorting: false,
  },
  {
    accessorKey: "needs_review",
    header: "Review",
    cell: ({ getValue }) => {
      const needs = getValue<boolean>()
      return (
        <span
          className={`inline-block h-2 w-2 rounded-full ${needs ? "bg-amber-500" : "bg-emerald-500"}`}
          title={needs ? "Needs review" : "Categorized"}
        />
      )
    },
    size: 60,
    enableSorting: false,
  },
]
