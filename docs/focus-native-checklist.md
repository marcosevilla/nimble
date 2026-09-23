# Focus companion and lifecycle — native synthetic checklist

Status: **written, not yet run.** This is the manual native acceptance list for Task 9 of the [Focus Queue absorption plan](superpowers/plans/2026-09-22-focus-queue-absorption.md) (spec §4 companion baseline, §6 lifecycle, §7 clocks). It is run later, by hand, on a real Mac. Unit and render tests cannot cover native windows, macOS power events, or audio.

## Ground rules

- Use a **synthetic profile only**. Launch a development build with a marked temporary profile (`NIMBLE_BACKUP_TEST_ROOT=<tmp dir containing synthetic-profile>`), or use demo mode. Never use the installed production app or its data, and never install over production.
- Create throwaway tasks in that profile. Do not connect Todoist, Google or Turso.
- For each item, record the date, build commit, macOS version, display setup, and pass or fail with a note.
- "Timer total" means the total in the committed snapshot, which both windows show. The engine is the only clock.

## Companion permissions (verify in the dev log)

The companion has its own capability, `capabilities/focus.json` (`focus-companion`). It is not in `default`. Its permissions are exactly:

- `core:event:allow-listen` and `core:event:allow-unlisten`, for the provider event bridge and resize events.
- `core:window:allow-current-monitor`, `allow-primary-monitor`, `allow-outer-position`, `allow-inner-size` and `allow-scale-factor`, all read-only geometry.

It has no fs, shell, clipboard, show/hide/size/position or start-dragging permission. The native titlebar drags without a permission. Resizing, positioning, showing main and opening a task go through the validated app commands `focus_companion_apply_geometry` and `focus_open_task_in_main`. Tauri app commands are not per-window gated without an app manifest.

0. Run the companion with the dev log open. Confirm there is no `not allowed` / permission error while it:
   - loads,
   - receives focus changes,
   - reads monitor geometry,
   - resizes (compact and expanded),
   - opens details in main.

## Window: open, activation, always-on-top

1. From expanded focus in main, click **Pop out**. The companion appears at once, already key, at the top-right of the current display's work area. Nothing starts, pauses or changes a total.
2. With the companion open, click into another app. The companion stays above that app's windows.
3. Check the companion over a full-screen app and across Spaces. Record what happens. The window is not set to show on all workspaces; decide whether that is acceptable.
4. Before live timing is wired (for example, a second process that does not own the profile), **Pop out** is disabled and shows the capability reason. Main shows the same reason, and Start/Resume are refused by the service, not only hidden.

## Drag, resize and scale

5. **Drag:** move the companion by its native titlebar. It follows the pointer and there is no dead drag region.
6. **Expanded:** the width is fixed at 340. Dragging the height stops at 420 and at 640; the queue scrolls and the footer stays anchored. Close and reopen the app: the expanded height comes back.
7. **Compact (card only):** click the chevron.
   - The window refits to the card's height plus the titlebar.
   - Dragging the width scales the card proportionally, from 1x at 340 up to 3x or min(1020, work area).
   - The height follows the width.
   - The remembered compact width is restored on the next compact toggle and after a relaunch.
8. **Long title with subtasks, compact:**
   - The scale drops so the card fits the display height.
   - At 1x, a card that is still too tall stays inside the work area and scrolls. It is never clipped.
9. **Small display (or a display scaled so the work area is under 340 logical px):** the window stays inside the work area at 1x and the content scrolls.
10. **Monitor removal:** leave the companion on an external display, then unplug the display. On refocus, the window's size and position clamp fully into the remaining display's work area.
11. **Motion:** expand and collapse fade over about 220ms, which is the Nimble base token. With System Settings → Accessibility → Display → Reduce motion on, the change is immediate.

## Chrome, shadow, titlebar offset, popovers

12. **Shadow bleed:** there is no clipped or doubled shadow at the window edge in light and dark, in every accent theme. There is no transparent gap between the content and the titlebar.
13. **Titlebar offset:** the first row of the card is not hidden under the 28px native titlebar in either mode. Geometry math assumes a 28px chrome; record the measured value if it differs.
14. **Popovers:** in compact at 1x, at 2x and in expanded mode, open the timebox picker, the task menu (…) and the source picker.
    - Each popover is positioned at its anchor.
    - Each is legible and not scaled twice.
    - Each can extend past the card without being cut off by the window edge. If it can't, record where it clips.

## Keyboard focus and visibility

15. Tab through the companion in expanded and compact modes.
    - Focus rings are visible on every control.
    - Compact mode has no tab stops for the hidden queue, Add, tray, drawer or footer.
    - "Show queue" stays reachable.
16. **Alt+Arrow reorder keeps keyboard focus:** in the Up next list (main and companion), focus a row and press Alt+↓ then Alt+↑. The moved row keeps keyboard focus after each committed reorder, and the focus ring stays visible. (This was only tested in markup for Task 7 I2.)
17. Space pauses a running timer from the companion. It never starts or resumes one.

## Close, hide, quit

18. With a running timer and both windows visible, close the companion. Timing continues, and main shows the same running total.
19. With a running timer and both windows visible, close main (hide). Timing continues in the companion.
20. Close the last visible focus window (companion closed, then main hidden; or main hidden, then companion closed). The timer pauses with the reason "the last focus window was closed". The total equals the time up to the close. Reopening either window never resumes it.
21. Hide main with the tray icon or ⌘⇧T while the companion is closed. This is the same as 20.
21a. **Open decision, record only:** ⌘H (hide the app) and minimizing main are *not* close events, so the timer keeps running.
   - Minimize main, then close the companion. This counts as no visible surface, so it pauses (AppKit reports a minimized window as not visible).
   - Record whether ⌘H with a running timer should also pause. The spec's "no hidden timer" suggests it should.
22. **Quit** (tray → Quit, and ⌘Q). On relaunch the timer is paused with the reason "Nimble quit", and the total includes time up to the quit.
23. **Forced quit** (`kill -9` of the dev process while running). On relaunch the timer is paused and recovered at the last durable checkpoint: at most 20 seconds are lost, and no downtime is credited.
24. **Second process:** start a second dev instance on the same profile while the first runs.
    - The second instance is read-only. Its reason says another Nimble process holds the profile.
    - It never bumps the first instance's process generation.
    - `dt task complete …` against that profile, while the first app's agent listener is stopped, fails with `app_unreachable` and writes nothing.

## Sleep and wake

Amended 2026-09-23 (Marco's decision): sleep keeps the timer running, crediting at most 30 minutes.

25. With a running timer, choose Apple menu → Sleep (or `pmset sleepnow`). Wait a few minutes (under 30), then wake. The timer is still running, and the total includes the sleep. No recovery message.
25a. **Long sleep:** sleep for more than 30 minutes with a running timer, then wake. The timer is paused with the reason "the Mac slept for more than 30 minutes", the total includes exactly 30 minutes of the sleep, and no sound plays. Nothing resumes; Resume is explicit.
26. **Lid-close or no-notice fallback:** if a sleep happens without the sleep/wake notices being delivered, the heartbeat after wake pauses at the last checkpoint, with the reason "gap exceeded 40 seconds", and credits none of the sleep.
26a. **Crash across a sleep:** with a running timer, `kill -9` the dev process, sleep the Mac, wake and relaunch. It is paused at the last checkpoint and none of the sleep is credited. A crash while asleep follows the same rule, because the sleep mark lives only in the running process (engine test `crash_during_sleep_credits_nothing_on_relaunch`).
27. Idle sleep/wake with nothing running shows no recovery message.

## Sound

28. A timebox reaching zero plays the chime exactly once and on time (within about a second of the displayed 0:00, not up to 20 s late), even with both windows open. Overtime continues in red and no further chime plays.
29. Completing the focused task plays the completion sound once, with both windows open.
30. With mute on (footer speaker toggle), neither sound plays, and a later unmute does not replay a missed sound.
31. With output muted or no audio device, timing and totals are unaffected.
32. A Pomodoro round end and a break end each chime once, on time. The card flips to "Start break" / "Start next round" at the boundary, not up to 20 s later.

## Display ticking

33. A running timer ticks about once a second in main, the banner and the companion, never in 20-second jumps. It never steps backwards when a heartbeat snapshot arrives.
34. When the timer is paused, stopped or hidden, the display stops ticking. When the window is shown again, it shows the committed total.
