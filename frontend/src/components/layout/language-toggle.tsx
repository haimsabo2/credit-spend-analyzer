import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export function LanguageToggle() {
  const { i18n, t } = useTranslation()

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={i18n.language === "he" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => i18n.changeLanguage("he")}
      >
        {t("common.hebrew")}
      </Button>
      <Button
        variant={i18n.language === "en" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => i18n.changeLanguage("en")}
      >
        {t("common.english")}
      </Button>
    </div>
  )
}
