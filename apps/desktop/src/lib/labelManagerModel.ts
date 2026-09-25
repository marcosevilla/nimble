/* Label Manager drag + keyboard model (C4). The manager is one flat sortable
   list — group header, its labels, …, the Ungrouped header, its labels — so
   a label's group is the nearest header above it. Pure; node tests import it
   (tests/labelManagerModel.test.mjs). */
import type { Label, LabelGroup } from '@nimble/types'
import type { ManagerModel } from './labelTaxonomy.ts'

export const UNGROUPED_KEY = 'ungrouped'
export const groupKey = (id: string) => `group:${id}`
export const labelKey = (id: string) => `label:${id}`

export type ManagerItem =
  | { kind: 'group'; key: string; groupId: string }
  | { kind: 'ungrouped'; key: typeof UNGROUPED_KEY }
  | { kind: 'label'; key: string; labelId: string }

export interface DropResult {
  items: ManagerItem[]
  /** Set when a label changed group (null = Ungrouped). */
  moved?: { labelId: string; groupId: string | null }
  /** Visible label ids in their new order (label moves only). */
  labelOrder?: string[]
  /** Regular group ids in their new order (group moves only). */
  groupOrder?: string[]
}

export function flattenManager(model: ManagerModel): ManagerItem[] {
  const items: ManagerItem[] = []
  for (const section of model.groups) {
    if (!section.group) continue
    items.push({ kind: 'group', key: groupKey(section.group.id), groupId: section.group.id })
    for (const l of section.labels) items.push({ kind: 'label', key: labelKey(l.id), labelId: l.id })
  }
  items.push({ kind: 'ungrouped', key: UNGROUPED_KEY })
  for (const l of model.ungrouped) items.push({ kind: 'label', key: labelKey(l.id), labelId: l.id })
  return items
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Group of the nearest header above `index`; null under Ungrouped. */
function headerAbove(items: readonly ManagerItem[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'group') return item.groupId
    if (item.kind === 'ungrouped') return null
  }
  return null
}

const labelIds = (items: readonly ManagerItem[]) => items.flatMap((i) => (i.kind === 'label' ? [i.labelId] : []))
const groupIds = (items: readonly ManagerItem[]) => items.flatMap((i) => (i.kind === 'group' ? [i.groupId] : []))

/** The flat list with group blocks in `order`; the Ungrouped block stays last. */
function withGroupOrder(items: readonly ManagerItem[], order: readonly string[]): ManagerItem[] {
  const blocks = new Map<string | null, ManagerItem[]>()
  let current: string | null = null
  for (const item of items) {
    if (item.kind === 'group') current = item.groupId
    if (item.kind === 'ungrouped') current = null
    blocks.set(current, [...(blocks.get(current) ?? []), item])
  }
  return [...order.flatMap((id) => blocks.get(id) ?? []), ...(blocks.get(null) ?? [])]
}

/** dnd-kit `onDragEnd`: drop `activeKey` onto `overKey`. null = nothing changed. */
export function applyDrop(items: readonly ManagerItem[], activeKey: string, overKey: string): DropResult | null {
  const from = items.findIndex((i) => i.key === activeKey)
  const to = items.findIndex((i) => i.key === overKey)
  if (from < 0 || to < 0 || from === to) return null
  const active = items[from]
  if (active.kind === 'label') {
    let next = move(items, from, to)
    let at = to
    if (at === 0) {
      next = move(next, 0, 1) // never above the first header
      at = 1
    }
    const before = headerAbove(items, from)
    const after = headerAbove(next, at)
    return {
      items: next,
      moved: before === after ? undefined : { labelId: active.labelId, groupId: after },
      labelOrder: labelIds(next),
    }
  }
  if (active.kind === 'group') {
    const order = groupIds(items)
    const target = items[to]
    const targetGroup = target.kind === 'group' ? target.groupId : target.kind === 'label' ? headerAbove(items, to) : null
    const toIndex = targetGroup === null ? order.length - 1 : order.indexOf(targetGroup)
    const nextOrder = move(order, order.indexOf(active.groupId), toIndex)
    if (nextOrder.every((id, i) => id === order[i])) return null
    return { items: withGroupOrder(items, nextOrder), groupOrder: nextOrder }
  }
  return null
}

/** ⌥↑ / ⌥↓: a label steps one row (crossing a header moves it into the
 *  neighbouring group); a group swaps with its neighbour. */
export function moveByKey(items: readonly ManagerItem[], key: string, direction: 'up' | 'down'): DropResult | null {
  const at = items.findIndex((i) => i.key === key)
  if (at < 0) return null
  const item = items[at]
  if (item.kind === 'label') {
    const target = direction === 'up' ? at - 1 : at + 1
    if (target < 1 || target >= items.length) return null
    return applyDrop(items, key, items[target].key)
  }
  if (item.kind === 'group') {
    const order = groupIds(items)
    const target = order.indexOf(item.groupId) + (direction === 'up' ? -1 : 1)
    if (target < 0 || target >= order.length) return null
    return applyDrop(items, key, groupKey(order[target]))
  }
  return null
}

/** Every label id in manager order — visible list, then system, then
 *  archived — so `labels.reorder` keeps every position unique. */
export function fullLabelOrder(items: readonly ManagerItem[], model: ManagerModel): string[] {
  return [
    ...labelIds(items),
    ...model.system.flatMap((s) => s.labels.map((l) => l.id)),
    ...model.archived.map((l) => l.id),
  ]
}

/** The optimistic view after a drop, as the server will store it. */
export function applyToTaxonomy(
  labels: Label[],
  groups: LabelGroup[],
  result: DropResult,
  fullOrder: readonly string[],
): { labels: Label[]; groups: LabelGroup[] } {
  const labelPos = new Map(fullOrder.map((id, i) => [id, i]))
  const groupPos = new Map((result.groupOrder ?? []).map((id, i) => [id, i]))
  return {
    labels: labels.map((l) => ({
      ...l,
      group: result.moved?.labelId === l.id ? result.moved.groupId : l.group,
      position: result.labelOrder ? labelPos.get(l.id) ?? l.position : l.position,
    })),
    groups: groups.map((g) => ({ ...g, position: groupPos.get(g.id) ?? g.position })),
  }
}

export function nextGroupName(groups: readonly LabelGroup[]): string {
  const taken = new Set(groups.map((g) => g.name.toLowerCase()))
  if (!taken.has('new group')) return 'New group'
  for (let n = 2; ; n++) if (!taken.has(`new group ${n}`)) return `New group ${n}`
}
