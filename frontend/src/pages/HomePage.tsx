import { useEffect } from 'react'
import AsciiField from '../components/home/AsciiField'
import TypedBlock from '../components/home/TypedBlock'
import './HomePage.css'

export default function HomePage() {
  useEffect(() => {
    document.body.classList.add('home-bg')
    return () => document.body.classList.remove('home-bg')
  }, [])

  return (
    <section className="home" aria-label="Home">
      <AsciiField />
      <div className="home-text">
        <TypedBlock />
      </div>
    </section>
  )
}
