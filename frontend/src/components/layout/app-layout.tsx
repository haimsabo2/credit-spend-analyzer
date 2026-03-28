import { Outlet } from "react-router-dom"
import { UploadJobBanner } from "@/components/upload/upload-job-banner"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ps-56">
        <Topbar />
        <UploadJobBanner />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
