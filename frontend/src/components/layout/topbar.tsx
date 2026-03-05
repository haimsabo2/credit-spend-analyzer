import { LanguageToggle } from "./language-toggle"

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-end border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <LanguageToggle />
    </header>
  )
}
