# Proposed /task-assist adapter — not activated

Preserve the source workflow's authorization and its emphasis on helping with the task rather than building a new system. No external skill changes are made by this proposal.

Resolve the exact Nimble task ID with `dt --json task get ID` before editing. Read current description, due fields and all labels. Perform the user's requested work, then update only the intended fields using `task update` or `task status`. Use `task complete` only when completion is authorized; recurrence is handled by Nimble itself. Do not clear labels, reminders or scheduling fields as a side effect of changing a description.

If Nimble is unavailable before any write, use an already-authorized Todoist task workflow only after identifying that record. A failed refresh or unknown command result is not evidence that no write occurred: read back and reconcile, without creating a substitute task. Instinct's productivity ownership remains unchanged until Marco changes it.
