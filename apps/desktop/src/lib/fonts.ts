export type ProductFont =
  | 'plus-jakarta-sans'
  | 'inter'
  | 'geist'
  | 'manrope'
  | 'ibm-plex-sans'
  | 'dm-sans'
  | 'system'

export interface FontOption {
  value: ProductFont
  label: string
  /** CSS font-family stack to apply when this font is selected. */
  stack: string
}

export const FONT_OPTIONS: FontOption[] = [
  {
    value: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    stack: "'Plus Jakarta Sans Variable', system-ui, sans-serif",
  },
  {
    value: 'inter',
    label: 'Inter',
    stack: "'Inter Variable', system-ui, sans-serif",
  },
  {
    value: 'geist',
    label: 'Geist',
    stack: "'Geist Variable', system-ui, sans-serif",
  },
  {
    value: 'manrope',
    label: 'Manrope',
    stack: "'Manrope Variable', system-ui, sans-serif",
  },
  {
    value: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    stack: "'IBM Plex Sans Variable', system-ui, sans-serif",
  },
  {
    value: 'dm-sans',
    label: 'DM Sans',
    stack: "'DM Sans Variable', system-ui, sans-serif",
  },
  {
    value: 'system',
    label: 'System',
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
  },
]

export const DEFAULT_HEADING_FONT: ProductFont = 'geist'
export const DEFAULT_BODY_FONT: ProductFont = 'geist'

export function getFontStack(value: ProductFont): string {
  return (
    FONT_OPTIONS.find((f) => f.value === value)?.stack ??
    FONT_OPTIONS[0].stack
  )
}
