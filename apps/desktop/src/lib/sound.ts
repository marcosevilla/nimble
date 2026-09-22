let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

/** Play a short, satisfying two-tone chime on task completion.
 *  Silent under prefers-reduced-motion — the OS-level "keep it calm" signal
 *  is the closest thing to a sound setting until one exists (session P1-1). */
export function playCompletionSound() {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = getAudioContext()
    const now = ctx.currentTime

    // First tone — C5 (523 Hz)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.value = 523
    gain1.gain.setValueAtTime(0.3, now)
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // Second tone — E5 (659 Hz), slightly delayed
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.value = 659
    gain2.gain.setValueAtTime(0.3, now + 0.08)
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.25)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.08)
    osc2.stop(now + 0.25)
  } catch {
    // Silently fail — audio is a nice-to-have
  }
}
