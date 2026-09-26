import { useEffect } from "react"

/* Keeps an open popup against its anchor when the page moves under it.

   Base UI positions popups with floating-ui's `autoUpdate`, which follows
   scrolls and resizes but spots a *layout shift* (content loading above the
   anchor, a list re-rendering) through an IntersectionObserver. In WebKit
   that observer loses an anchor pushed below the fold: the popup followed it
   down but stayed stranded when it came back, until floating-ui's 1 s
   clipped-anchor retry (found via the t2-row-keys AC2 Today flake — Today's
   boxes load after its rows and push them ~350px down).

   While a popup is open this reads its anchor's box once per frame (the
   anchor is the trigger Base UI marks `data-popup-open`) and, when it moved,
   fires a `scroll` on `window` — one of the events every open popup's
   autoUpdate already listens to — so they reposition on the next frame.
   Same cost as floating-ui's own `animationFrame` option, only while open.

   Rendered inside a Positioner, so it mounts only while its popup does. */
export function FollowAnchor() {
  useEffect(() => {
    let frame = 0
    let last: string | null = null
    const tick = () => {
      let key = ""
      for (const el of document.querySelectorAll("[data-popup-open]")) {
        const r = el.getBoundingClientRect()
        key += `${r.left},${r.top},${r.width},${r.height};`
      }
      if (last !== null && key !== last) window.dispatchEvent(new Event("scroll"))
      last = key
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return null
}
