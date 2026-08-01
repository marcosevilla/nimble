import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

/* Typography primitives. Each one renders the corresponding text-<name>
   utility class, whose full typographic payload — font-family, size, line-
   height, weight, tracking, case — lives in index.css as CSS custom
   properties. The TypographyTuner panel writes to those vars on :root, so
   primitives intentionally DO NOT stack Tailwind utilities like `uppercase`
   or `tracking-wider` on top — that would prevent the tuner from
   overriding them. If a caller needs to override for a specific spot,
   className on the primitive still wins via cn/twMerge. */

const labelVariants = cva('inline-flex items-center gap-1.5 text-label', {
  variants: {
    tone: {
      muted: 'text-muted-foreground',
      default: 'text-foreground',
    },
  },
  defaultVariants: { tone: 'muted' },
})

type LabelProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof labelVariants> & {
    as?: 'span' | 'div' | 'p' | 'h2' | 'h3' | 'h4'
  }

export function Label({ className, tone, as: Tag = 'span', ...props }: LabelProps) {
  return <Tag className={cn(labelVariants({ tone }), className)} {...props} />
}

const metaVariants = cva('text-meta', {
  variants: {
    tone: {
      muted: 'text-muted-foreground',
      default: 'text-foreground',
      faint: 'text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'muted' },
})

type MetaProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof metaVariants> & {
    as?: 'span' | 'div' | 'p' | 'time'
  }

export function Meta({ className, tone, as: Tag = 'span', ...props }: MetaProps) {
  return <Tag className={cn(metaVariants({ tone }), className)} {...props} />
}

const captionVariants = cva('text-label', {
  variants: {
    tone: {
      muted: 'text-muted-foreground',
      default: 'text-foreground',
      faint: 'text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'muted' },
})

type CaptionProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof captionVariants> & {
    as?: 'span' | 'div' | 'p'
  }

export function Caption({ className, tone, as: Tag = 'span', ...props }: CaptionProps) {
  return <Tag className={cn(captionVariants({ tone }), className)} {...props} />
}

const bodyStrongVariants = cva('text-body-strong', {
  variants: {
    tone: {
      muted: 'text-muted-foreground',
      default: 'text-foreground',
    },
  },
  defaultVariants: { tone: 'default' },
})

type BodyStrongProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof bodyStrongVariants> & {
    as?: 'span' | 'div' | 'p' | 'h2' | 'h3' | 'h4'
  }

export function BodyStrong({ className, tone, as: Tag = 'span', ...props }: BodyStrongProps) {
  return <Tag className={cn(bodyStrongVariants({ tone }), className)} {...props} />
}

type FieldLabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return <label className={cn('text-body text-foreground', className)} {...props} />
}

type SectionTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h2' | 'h3' | 'h4'
}

export function SectionTitle({
  className,
  as: Tag = 'h3',
  ...props
}: SectionTitleProps) {
  return <Tag className={cn('text-title text-foreground', className)} {...props} />
}

type PageTitleProps = React.HTMLAttributes<HTMLHeadingElement>

export function PageTitle({ className, ...props }: PageTitleProps) {
  return <h1 className={cn('text-title truncate', className)} {...props} />
}
