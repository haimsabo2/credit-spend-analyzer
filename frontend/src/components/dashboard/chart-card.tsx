import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface ChartCardProps {
  title: string
  children: React.ReactNode
  className?: string
}

export function ChartCard({ title, children, className }: ChartCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardHeader className="pb-2">
        <p className="text-sm font-semibold">{title}</p>
      </CardHeader>
      <CardContent className="min-h-[200px]">{children}</CardContent>
    </Card>
  )
}
