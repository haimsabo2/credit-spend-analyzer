import { Settings2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export default function RulesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <Settings2 className="h-10 w-10" />
          <p className="text-sm">
            Manage classification rules for automatic transaction categorization.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
