import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Meta } from '@/components/shared/typography'
import { useDataProvider } from '@/services/provider-context'
import { settingsMessage } from '@/lib/settingsMessage'
import { isSetupReady } from '@/lib/setupGate'

interface SetupDialogProps {
  open: boolean
  onComplete: () => void
}

interface SetupField {
  key: string
  label: string
  placeholder: string
  help: string
  type?: string
  optional?: boolean
}

const SETUP_FIELDS: SetupField[] = [
  {
    key: 'todoist_api_token',
    label: 'Todoist API token',
    placeholder: 'Paste your token here',
    help: 'Settings → Integrations → Developer → API token',
    type: 'password',
  },
  {
    key: 'ical_feed_url',
    label: 'Google Calendar iCal URL',
    placeholder: 'https://calendar.google.com/calendar/ical/...',
    help: 'Google Calendar → Settings → Calendar → "Secret address in iCal format"',
    optional: true,
  },
  {
    key: 'obsidian_vault_path',
    label: 'Obsidian vault path',
    placeholder: '~/Obsidian/marcowits',
    help: 'Absolute path to your vault folder',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic API key',
    placeholder: 'sk-ant-...',
    help: 'console.anthropic.com → API Keys',
    type: 'password',
  },
]

export function SetupDialog({ open, onComplete }: SetupDialogProps) {
  const dp = useDataProvider()
  const [values, setValues] = useState<Record<string, string>>({
    obsidian_vault_path: '~/Obsidian/marcowits',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Required keys mirror the Rust launch check (lib/setupGate.ts).
  const ready = isSetupReady(values)

  async function handleSave() {
    if (saving || !ready) return
    setSaving(true)
    setError(null)
    try {
      for (const field of SETUP_FIELDS) {
        const val = values[field.key]?.trim()
        if (val) {
          await dp.settings.set(field.key, val)
        }
      }
      onComplete()
    } catch (e) {
      setError(settingsMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    // Setup is blocking: no close control, and Escape / outside click are
    // ignored (open is controlled, no onOpenChange). Only Get started completes.
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-title">Welcome to Nimble</DialogTitle>
          <DialogDescription>
            Connect your accounts to get started. These stay on your machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {SETUP_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key} className="text-body-strong">
                {field.label}
                {field.optional && <Meta as="span"> (optional)</Meta>}
              </Label>
              <Input
                id={field.key}
                type={field.type || 'text'}
                placeholder={field.placeholder}
                value={values[field.key] || ''}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
              />
              <Meta as="p">{field.help}</Meta>
            </div>
          ))}

          {error && (
            <p className="text-body text-destructive">{error}</p>
          )}

          <Button
            onClick={handleSave}
            disabled={!ready || saving}
            className="w-full"
          >
            {saving ? 'Saving...' : 'Get started'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
