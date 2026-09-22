import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { HelpCircle, X, Keyboard, Map } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Label, Meta } from '@/components/shared/typography'
import { shortcutsBySection } from '@/lib/shortcuts'
import { useHelpPanelStore } from '@/stores/helpPanelStore'

// Shortcut rows come from the one registry both the handlers and this panel
// read (lib/shortcuts.ts). Roadmap items used to live here as a 46-item
// array; NEXT.md is the source of truth, so the tab now just points there.

// ── Component ──

export function HelpPanel() {
  const open = useHelpPanelStore((s) => s.open)
  const setOpen = useHelpPanelStore((s) => s.setOpen)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const closePanel = useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 150)
  }, [setOpen])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel()
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [open, closePanel])

  // Escape closes the panel. Capture phase so the Dashboard's own Escape
  // (clear selection / close detail) doesn't also fire for this keypress.
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closePanel()
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [open, closePanel])

  return (
    <>
      {/* Floating button */}
      <button
        aria-label="Keyboard shortcuts (?)"
        aria-expanded={open}
        onClick={() => {
          if (open) closePanel()
          else setOpen(true)
        }}
        className={cn(
          'fixed bottom-4 right-4 z-30 flex size-9 items-center justify-center rounded-full transition-all duration-200',
          'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-muted-foreground hover:shadow-md',
          'backdrop-blur-sm border border-border/20',
          open && 'bg-muted text-muted-foreground shadow-md',
          'before:absolute before:inset-[-2px] before:content-[\'\'] before:rounded-full',
        )}
      >
        {open ? <X className="size-4" /> : <HelpCircle className="size-4" />}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className={cn(
            'fixed bottom-16 right-4 z-30 transition-all duration-150 origin-bottom-right',
            closing
              ? 'opacity-0 scale-95'
              : 'help-panel-enter',
          )}
        >
          <div className="w-80 max-h-[50vh] flex flex-col rounded-xl border border-border/30 bg-popover shadow-xl shadow-black/10 overflow-hidden">
            <Tabs defaultValue="shortcuts" className="flex flex-col gap-0 min-h-0">
              {/* Tab switcher */}
              <div className="border-b border-border/20 px-1 pt-1 shrink-0">
                <TabsList variant="line" className="h-auto gap-0 bg-transparent p-0">
                  <TabsTrigger value="shortcuts" className="gap-1.5 rounded-t-lg rounded-b-none px-3 py-2 text-meta">
                    <Keyboard className="size-3" />
                    Shortcuts
                  </TabsTrigger>
                  <TabsTrigger value="roadmap" className="gap-1.5 rounded-t-lg rounded-b-none px-3 py-2 text-meta">
                    <Map className="size-3" />
                    Roadmap
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Content */}
              <div className="overflow-y-auto p-3">
                <TabsContent value="shortcuts">
                  <ShortcutsTab />
                </TabsContent>
                <TabsContent value="roadmap">
                  <Meta as="p">The roadmap lives in NEXT.md at the repo root — what's open, what's decided, newest first.</Meta>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      )}
    </>
  )
}

// ── Shortcuts tab ──

function ShortcutsTab() {
  return (
    <div className="space-y-4">
      {shortcutsBySection().map((section) => (
        <div key={section.title}>
          <Label as="h3" className="mb-1.5 text-muted-foreground">
            {section.title}
          </Label>
          <div className="space-y-1">
            {section.rows.map((shortcut) => (
              <div key={shortcut.keys} className="flex items-center justify-between gap-3 py-0.5">
                <Meta>{shortcut.label}</Meta>
                <kbd className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-label text-muted-foreground">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
