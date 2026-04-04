import { BrowserRouter, Routes, Route } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { AppLayout } from "@/components/layout/app-layout"
import { UploadJobHydrationFix } from "@/components/upload/upload-job-hydration"
import { queryClient } from "@/lib/query-client"
import DashboardPage from "@/pages/dashboard"
import UploadPage from "@/pages/upload"
import MonthsPage from "@/pages/months"
import TransactionsPage from "@/pages/transactions"
import NeedsReviewPage from "@/pages/needs-review"
import MerchantSpendGroupsPage from "@/pages/merchant-spend-groups"

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UploadJobHydrationFix />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="months" element={<MonthsPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="review" element={<NeedsReviewPage />} />
            <Route path="merchant-spend-groups" element={<MerchantSpendGroupsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  )
}
