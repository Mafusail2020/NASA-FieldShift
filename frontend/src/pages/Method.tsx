import { useI18n } from '../i18n'

export default function Method() {
  const { t } = useI18n()
  return <main><h1>{t('method.title')}</h1><p className="todo">{t('method.todo')}</p></main>
}
