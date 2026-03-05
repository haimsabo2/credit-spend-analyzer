import { Link } from "react-router-dom"
import { UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function EmptyState() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="rounded-full bg-muted p-4">
            <UploadCloud className="h-10 w-10 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">
              No statements uploaded yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Upload your first credit card statement to see spending insights,
              trends, and anomalies.
            </p>
          </div>
          <Button asChild size="lg" className="mt-2">
            <Link to="/months">Upload your first statement</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
