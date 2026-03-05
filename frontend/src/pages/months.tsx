import { useState, useRef, useCallback } from "react"
import { useMonthStore, formatMonthLabel } from "@/stores/use-month-store"
import { useUploads } from "@/hooks/use-uploads"
import { useUploadFile } from "@/hooks/use-upload-file"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  UploadCloud,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  Inbox,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { UploadCreateResponse } from "@/types/api"

export default function MonthsPage() {
  const month = useMonthStore((s) => s.month)
  const setMonth = useMonthStore((s) => s.setMonth)
  const uploads = useUploads()
  const uploadFile = useUploadFile()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadMonth, setUploadMonth] = useState(month)
  const [dragOver, setDragOver] = useState(false)
  const [lastResult, setLastResult] = useState<UploadCreateResponse | null>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".xls")) {
      return
    }
    setSelectedFile(file)
    setLastResult(null)
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
  }

  function handleBrowse() {
    fileInputRef.current?.click()
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ""
  }

  function handleUpload() {
    if (!selectedFile) return
    uploadFile.mutate(
      { file: selectedFile, month: uploadMonth },
      {
        onSuccess(data) {
          setLastResult(data)
          setSelectedFile(null)
        },
      },
    )
  }

  function handleClear() {
    setSelectedFile(null)
    setLastResult(null)
  }

  function handleRowClick(rowMonth: string) {
    setMonth(rowMonth)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Months</h1>
        <p className="text-sm text-muted-foreground">
          Upload credit card statements and browse past uploads
        </p>
      </div>

      {/* Upload zone */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UploadCloud className="h-5 w-5 text-muted-foreground" />
            Upload Statement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleBrowse}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls"
              className="hidden"
              onChange={handleInputChange}
            />
            {selectedFile ? (
              <>
                <FileSpreadsheet className="h-10 w-10 text-emerald-600" />
                <div>
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(0)} KB &middot; Click to change
                  </p>
                </div>
              </>
            ) : (
              <>
                <UploadCloud className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">
                    Drop your .xls statement here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Only .xls files are supported
                  </p>
                </div>
              </>
            )}
          </div>

          {selectedFile && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Statement Month</label>
                <Input
                  type="month"
                  value={uploadMonth}
                  onChange={(e) => setUploadMonth(e.target.value)}
                  className="w-44"
                />
              </div>
              <Button
                className="gap-1.5"
                onClick={handleUpload}
                disabled={uploadFile.isPending}
              >
                {uploadFile.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="h-4 w-4" />
                )}
                Upload
              </Button>
              <Button variant="ghost" size="icon" onClick={handleClear}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload result */}
      {lastResult && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="space-y-2">
                <p className="font-medium text-emerald-800">Upload successful</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-emerald-700">
                  <span>
                    <strong>{lastResult.inserted_count}</strong> transactions imported
                  </span>
                  {lastResult.skipped_duplicates_count > 0 && (
                    <span>
                      {lastResult.skipped_duplicates_count} duplicates skipped
                    </span>
                  )}
                  {lastResult.skipped_noise_count > 0 && (
                    <span>{lastResult.skipped_noise_count} noise rows skipped</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {lastResult.cards_detected.map((c) => (
                    <Badge key={c} variant="outline" className="bg-white text-xs">
                      {c}
                    </Badge>
                  ))}
                  {lastResult.sections_detected.map((s) => (
                    <Badge key={s} variant="secondary" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload History</CardTitle>
        </CardHeader>
        <CardContent>
          {uploads.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !uploads.data || uploads.data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="text-sm">No uploads yet. Upload your first statement above.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.data.map((u) => (
                    <TableRow
                      key={u.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleRowClick(u.month)}
                    >
                      <TableCell>
                        <Badge variant={u.month === month ? "default" : "outline"}>
                          {formatMonthLabel(u.month)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {u.original_filename}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.num_transactions}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {(u.size_bytes / 1024).toFixed(0)} KB
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
