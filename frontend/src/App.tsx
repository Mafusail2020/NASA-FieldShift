import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { BackendProvider, useBackend } from './backend'
import { I18nProvider, useI18n } from './i18n'
import Method from './pages/Method'
import Results from './pages/Results'
import Start from './pages/Start'

function Header() {
  const { t, lang, setLang } = useI18n()
  const backend = useBackend()
  return (
    <>
      <header>
        <Link to="/" className="brand">{t('app.title')}</Link>
        <nav><Link to="/">{t('nav.start')}</Link><Link to="/method">{t('nav.method')}</Link></nav>
        <div className="lang" role="group" aria-label="language">
          {(['en', 'uk'] as const).map((l) => <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
        </div>
      </header>
      {backend.offline && <div className="banner">{t('offline.banner')}</div>}
    </>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <BackendProvider>
        <BrowserRouter>
          <Header />
          <Routes>
            <Route path="/" element={<Start />} />
            <Route path="/results/:region" element={<Results />} />
            <Route path="/method" element={<Method />} />
          </Routes>
        </BrowserRouter>
      </BackendProvider>
    </I18nProvider>
  )
}
