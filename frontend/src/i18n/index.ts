import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import he from "./he.json"
import en from "./en.json"

function setDocumentDir(lang: string) {
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr"
  document.documentElement.lang = lang
}

i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: "he",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
})

setDocumentDir(i18n.language)
i18n.on("languageChanged", setDocumentDir)
