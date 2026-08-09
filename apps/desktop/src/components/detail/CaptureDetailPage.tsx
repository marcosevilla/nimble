import { useState, useCallback, useEffect } from 'react'
import { useDetailStore } from '@/stores/detailStore'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { DetailBreadcrumbs } from './DetailBreadcrumbs'
import { TaskActivityLog } from './TaskActivityLog'
import { IconButton } from '@/components/shared/IconButton'
import { PanelRight, X, Trash2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { taskToast } from '@/lib/taskToast'
import type { Capture } from '@nimble/types'

export function CaptureDetailPage() {
  const dp = useDataProvider()
  const target = useDetailStore((s) => s.target)
  const switchMode = useDetailStore((s) => s.switchMode)
  const close = useDetailStore((s) => s.close)

  const [capture, setCapture] = useState<Capture | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!target?.id) return
    try {
      const all = await dp.captures.list(100, true)
      const found = all.find((c) => c.id === target.id) ?? null
      setCapture(found)
    } catch {
      setCapture(null)
    } finally {
      setLoading(false)
    }
  }, [target?.id, dp])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  const handleConvert = useCallback(async () => {
    if (!capture) return
    try {
      const task = await dp.captures.convertToTask(capture.id)
      taskToast(`Converted to task: "${capture.content}"`, task.id)
      emitTasksChanged()
      // Open the new task detail
      useDetailStore.getState().openTask(task.id)
    } catch (e) {
      toast.error(`Failed to convert: ${e}`)
    }
  }, [capture, dp])

  const handleDelete = useCallback(async () => {
    if (!capture) return
    try {
      await dp.captures.delete(capture.id)
      toast.success('Note deleted')
      close()
    } catch (e) {
      toast.error(`Failed to delete note: ${e}`)
    }
  }, [capture, close, dp])

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
    )
  }

  if (!capture) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <p className="text-body text-muted-foreground">Note not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <DetailBreadcrumbs />
        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            onClick={() => switchMode('sidebar')}
            size="lg"
            title="Open in sidebar"
          >
            <PanelRight className="size-4" />
          </IconButton>
          <IconButton
            onClick={close}
            size="lg"
            title="Close"
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-2">
        {/* leading-relaxed is a deliberate prose override on text-title — captures are read like a journal entry, 1.25 feels too tight */}
        <p className="text-title leading-relaxed">{capture.content}</p>
        <div className="flex items-center gap-3 text-meta text-muted-foreground">
          <span>{formatTime(capture.created_at)}</span>
          {capture.source !== 'manual' && capture.source !== 'inbox' && (
            <span className="rounded-md bg-muted/40 px-1.5 py-0.5">via {capture.source}</span>
          )}
          {capture.converted_to_task_id && (
            <span className="text-green-500/60">Converted to task</span>
          )}
        </div>
      </div>

      {/* Actions */}
      {!capture.converted_to_task_id && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleConvert} className="gap-1.5">
            <ArrowRight className="size-3.5" />
            Convert to task
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="gap-1.5 text-destructive/60 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      )}

      {/* Separator */}
      <div className="border-t border-border/30" />

      {/* Activity log */}
      <TaskActivityLog taskId={capture.id} />
    </div>
  )
}
