import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/* Teach tailwind-merge about our custom `@theme` tokens so that combining
 * a custom `text-<size>` with a custom `text-<color>` inside cn() doesn't
 * silently drop one. Out of the box, tailwind-merge only recognizes the
 * stock Tailwind values (text-lg, text-red-500, etc.); our design-system
 * classes would be lumped into a generic "text-" bucket and collide.
 *
 * Keep these arrays in sync with:
 *   - Font sizes: the `@theme { --text-<name>: ... }` entries in index.css
 *   - Text colors: the `@theme inline { --color-<name>: ... }` entries in
 *     index.css that are exposed as `text-<name>` utilities.
 *
 * If you add a new token, add it here too or the old cn() collapse bug
 * will reappear on any site that composes it with a color class. */
const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'label',
            'meta',
            'meta-strong',
            'body',
            'body-strong',
            'title',
            'display',
            'timer',
          ],
        },
      ],
      'text-color': [
        {
          text: [
            'background',
            'foreground',
            'card',
            'card-foreground',
            'popover',
            'popover-foreground',
            'primary',
            'primary-foreground',
            'secondary',
            'secondary-foreground',
            'muted',
            'muted-foreground',
            'accent',
            'accent-foreground',
            'destructive',
            'border',
            'input',
            'ring',
            'chart-1',
            'chart-2',
            'chart-3',
            'chart-4',
            'chart-5',
            'sidebar',
            'sidebar-foreground',
            'sidebar-primary',
            'sidebar-primary-foreground',
            'sidebar-accent',
            'sidebar-accent-foreground',
            'sidebar-border',
            'sidebar-ring',
            'accent-blue',
            'success',
            'success-fg',
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs))
}
