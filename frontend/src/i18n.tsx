import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import en from './locales/en.json'
import uk from './locales/uk.json'

export type Lang = 'en' | 'uk'
const DICT: Record<Lang, Record<string, string>> = { en, uk }

interface I18n { lang: Lang; setLang(l: Lang): void; t(key: string, vars?: Record<string, string | number>): string }
const Ctx = createContext<I18n | null>(null)
export const useI18n = () => useContext(Ctx)!

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'uk' || q === 'en') return q
    try { return localStorage.getItem('lang') === 'uk' ? 'uk' : 'en' } catch { return 'en' }
  })
  const setLang = (l: Lang) => {
    setLangState(l)
    try { localStorage.setItem('lang', l) } catch { /* private mode */ }
  }
  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const s = DICT[lang][key] ?? DICT.en[key] ?? key
    return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s
  }, [lang])
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}
