import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import {
  DEFAULT_BODY_FONT,
  DEFAULT_HEADING_FONT,
  FONT_OPTIONS,
  getFontStack,
  type ProductFont,
} from '@/lib/fonts'

type Mode = 'light' | 'dark' | 'system'
export type AccentTheme = 'warm' | 'ocean' | 'rose' | 'mono' | 'forest' | 'runner'

const ACCENT_THEMES: AccentTheme[] = ['warm', 'ocean', 'rose', 'mono', 'forest', 'runner']
const FONT_VALUES = new Set<ProductFont>(FONT_OPTIONS.map((f) => f.value))

function applyMode(mode: Mode) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)

  root.classList.toggle('dark', isDark)
  localStorage.setItem('theme', mode)
}

function applyAccent(accent: AccentTheme) {
  const root = document.documentElement

  // Remove all theme classes, add the active one
  for (const t of ACCENT_THEMES) {
    root.classList.remove(`theme-${t}`)
  }
  root.classList.add(`theme-${accent}`)
  localStorage.setItem('accent_theme', accent)
}

function applyFont(kind: 'heading' | 'body', value: ProductFont) {
  const root = document.documentElement
  const varName = kind === 'heading' ? '--font-heading' : '--font-sans'
  root.style.setProperty(varName, getFontStack(value))
  localStorage.setItem(kind === 'heading' ? 'heading_font' : 'body_font', value)
}

function parseFont(raw: string | null, fallback: ProductFont): ProductFont {
  if (raw && FONT_VALUES.has(raw as ProductFont)) return raw as ProductFont
  return fallback
}

export function useTheme() {
  const dp = useDataProvider()

  const [theme, setThemeState] = useState<Mode>(() => {
    return (localStorage.getItem('theme') as Mode) || 'system'
  })

  const [accent, setAccentState] = useState<AccentTheme>(() => {
    return (localStorage.getItem('accent_theme') as AccentTheme) || 'warm'
  })

  const [headingFont, setHeadingFontState] = useState<ProductFont>(() =>
    parseFont(localStorage.getItem('heading_font'), DEFAULT_HEADING_FONT),
  )

  const [bodyFont, setBodyFontState] = useState<ProductFont>(() =>
    parseFont(localStorage.getItem('body_font'), DEFAULT_BODY_FONT),
  )

  const setTheme = useCallback(async (newTheme: Mode) => {
    setThemeState(newTheme)
    applyMode(newTheme)
    try {
      await dp.settings.set('theme', newTheme)
    } catch {
      // Silently fail — localStorage is the fallback
    }
  }, [dp])

  const setAccent = useCallback(async (newAccent: AccentTheme) => {
    setAccentState(newAccent)
    applyAccent(newAccent)
    try {
      await dp.settings.set('accent_theme', newAccent)
    } catch {
      // Silently fail — localStorage is the fallback
    }
  }, [dp])

  const setHeadingFont = useCallback(async (font: ProductFont) => {
    setHeadingFontState(font)
    applyFont('heading', font)
    try {
      await dp.settings.set('heading_font', font)
    } catch {
      // Silently fail
    }
  }, [dp])

  const setBodyFont = useCallback(async (font: ProductFont) => {
    setBodyFontState(font)
    applyFont('body', font)
    try {
      await dp.settings.set('body_font', font)
    } catch {
      // Silently fail
    }
  }, [dp])

  // On mount: read from SQLite, apply
  useEffect(() => {
    Promise.all([
      dp.settings.get('theme'),
      dp.settings.get('accent_theme'),
      dp.settings.get('heading_font'),
      dp.settings.get('body_font'),
    ]).then(([storedMode, storedAccent, storedHeadingFont, storedBodyFont]) => {
      const m = (storedMode as Mode) || 'system'
      const a = (storedAccent as AccentTheme) || 'warm'
      const hf = parseFont(storedHeadingFont, DEFAULT_HEADING_FONT)
      const bf = parseFont(storedBodyFont, DEFAULT_BODY_FONT)
      setThemeState(m)
      setAccentState(a)
      setHeadingFontState(hf)
      setBodyFontState(bf)
      applyMode(m)
      applyAccent(a)
      applyFont('heading', hf)
      applyFont('body', bf)
    }).catch(() => {
      applyMode('system')
      applyAccent('warm')
      applyFont('heading', DEFAULT_HEADING_FONT)
      applyFont('body', DEFAULT_BODY_FONT)
    })
  }, [dp])

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyMode('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return {
    theme,
    setTheme,
    accent,
    setAccent,
    headingFont,
    setHeadingFont,
    bodyFont,
    setBodyFont,
  }
}
