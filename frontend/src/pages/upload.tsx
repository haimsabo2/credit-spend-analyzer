import { useTranslation } from "react-i18next"

export default function UploadPage() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("nav.upload")}</h1>
      <p className="mt-2 text-muted-foreground">Upload placeholder</p>
    </div>
  )
}
