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
import CategoryMerchantsPage from "@/pages/category-merchants"
import BudgetsPage from "@/pages/budgets"
import ExportPage from "@/pages/export"
import RulesPage from "@/pages/rules"
import RecurringSpendPage from "@/pages/recurring-spend"

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
            <Route path="categories/merchants" element={<CategoryMerchantsPage />} />
            <Route path="budgets" element={<BudgetsPage />} />
            <Route path="export" element={<ExportPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="recurring" element={<RecurringSpendPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      {/* Below app modals (dialog overlay z-[100]); Sonner default z-index is ~1e9 and can cover Radix portals */}
      <Toaster richColors position="top-center" style={{ zIndex: 40 }} />
    </QueryClientProvider>
  )
}
