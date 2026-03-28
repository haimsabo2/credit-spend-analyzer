import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  className?: string
}

export function StatCard({ title, value, subtitle, className }: StatCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-1">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {subtitle ? (
          <p className="mt-1 text-xs text-muted-foreground leading-snug">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
