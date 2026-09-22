# Proposed /brief adapter — not activated

This proposal replaces only the task/activity reads after Marco approves the data-source change. It does not alter calendar/email access, scheduling, notifications or installed skills.

Read `dt --json task list` with an explicit due/project scope where useful; read `activity list --from DATE --to DATE` for the brief's date window. Read exact task IDs to retain descriptions and distinguish completed/recurring tasks. Generate the brief using the existing skill's tone and rules. Do not modify or complete tasks as part of a read-only brief.

A successful empty list means no matching records. A JSON error means the source is unavailable; identify that gap. During the trial an authorized Todoist read source can substitute, but label which source was used and avoid combining matching records into duplicates. Do not invent task details from a failed query.
