// Parses NEXT.md (the project's open-loops file) into the Help panel's
// Roadmap tab. Only `- [ ]` / `- [x]` items count, grouped by `##` heading;
// prose bullets and sections without any checkbox items are skipped.

export interface RoadmapItem {
  done: boolean
  text: string
}

export interface RoadmapSection {
  title: string
  items: RoadmapItem[]
}

const HEADING = /^##\s+(.+?)\s*$/
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/

/** Markdown inline syntax → plain text (bold/italic, code, links). */
function plain(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:])/g, '$1$2')
    .trim()
}

export function parseRoadmap(md: string): RoadmapSection[] {
  const sections: RoadmapSection[] = []
  let current: RoadmapSection | null = null
  for (const line of md.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      current = { title: plain(heading[1]), items: [] }
      sections.push(current)
      continue
    }
    const item = CHECKBOX.exec(line)
    if (item && current) {
      current.items.push({ done: item[1] !== ' ', text: plain(item[2]) })
    }
  }
  return sections.filter((s) => s.items.length > 0)
}
