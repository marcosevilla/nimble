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
}

const SETUP_FIELDS: SetupField[] = [
  {
    key: 'todoist_api_token',
    label: 'Todoist API Token',
    placeholder: 'Paste your token here',
    help: 'Settings → Integrations → Developer → API token',
    type: 'password',
  },
  {
    key: 'ical_feed_url',
    label: 'Google Calendar iCal URL',
    placeholder: 'https://calendar.google.com/calendar/ical/...',
    help: 'Google Calendar → Settings → Calendar → "Secret address in iCal format"',
  },
  {
    key: 'obsidian_vault_path',
    label: 'Obsidian Vault Path',
    placeholder: '~/Obsidian/marcowits',
    help: 'Absolute path to your vault folder',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic API Key',
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

  const allFilled = SETUP_FIELDS.every((f) => values[f.key]?.trim())

  async function handleSave() {
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
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="text-title">Welcome to Daily Triage</DialogTitle>
          <DialogDescription>
            Connect your accounts to get started. These stay on your machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {SETUP_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key} className="text-body-strong">
                {field.label}
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
            disabled={!allFilled || saving}
            className="w-full"
          >
            {saving ? 'Saving...' : 'Get Started'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
