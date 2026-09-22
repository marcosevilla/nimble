import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  // Resolve theme from the <html> class (managed by useTheme hook)
  const isDark = document.documentElement.classList.contains("dark")
  const theme: ToasterProps["theme"] = isDark ? "dark" : "light"

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // Clear of the floating help button (size-9 at bottom-4/right-4 → 52px tall band).
      offset={{ bottom: 64, right: 24 }}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // Sonner's own stylesheet is unlayered and sets the font on the
          // toaster, so a Tailwind `font-sans` class loses; inline wins.
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
        // Sonner hardcodes the toast box-shadow; inline maps it to the token.
        style: { boxShadow: "var(--shadow-popover)" },
      }}
      {...props}
    />
  )
}

export { Toaster }
