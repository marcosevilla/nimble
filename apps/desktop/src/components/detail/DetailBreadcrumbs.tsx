import { useDetailStore } from '@/stores/detailStore'
import { useGoalsStore } from '@/stores/goalsStore'
import { useTaskDetail } from '@/hooks/useTaskDetail'
import { ArrowLeft, ChevronRight } from 'lucide-react'

function BreadcrumbLabel({ type, id }: { type: string; id: string }) {
  const { task } = useTaskDetail(type === 'task' ? id : null)
  const goalName = useGoalsStore((s) => type === 'goal' ? s.goals.find((g) => g.id === id)?.name : undefined)
  if (type === 'capture') return <span>Note</span>
  if (type === 'goal') return <span className="truncate">{goalName ?? 'Goal'}</span>
  return <span className="truncate">{task?.content ?? '...'}</span>
}

export function DetailBreadcrumbs() {
  const breadcrumbs = useDetailStore((s) => s.breadcrumbs)
  const navigateUp = useDetailStore((s) => s.navigateUp)
  const close = useDetailStore((s) => s.close)

  return (
    <div className="flex items-center gap-1 text-body mb-4">
      <button
        onClick={() => breadcrumbs.length > 0 ? navigateUp() : close()}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        <ArrowLeft className="size-4" />
        <span>Back</span>
      </button>

      {breadcrumbs.length > 0 && (
        <>
          <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
          {breadcrumbs.map((crumb, i) => (
            <div key={`${crumb.type}-${crumb.id}`} className="flex items-center gap-1 min-w-0">
              <button
                onClick={() => navigateUp(i)}
                className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[120px]"
              >
                <BreadcrumbLabel type={crumb.type} id={crumb.id} />
              </button>
              <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
            </div>
          ))}
        </>
      )}
    </div>
  )
}
