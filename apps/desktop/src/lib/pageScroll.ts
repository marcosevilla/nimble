/** Scroll the shell's page scroller (Dashboard `[data-page-scroller]`) back
 *  to the top — for in-page mode swaps that should land like a new page. */
export function scrollPageToTop(from?: Element | null) {
  const scroller = from?.closest('[data-page-scroller]') ?? document.querySelector('[data-page-scroller]')
  if (scroller) scroller.scrollTop = 0
}
