# Proposed /td adapter — not activated

Use `dt --json` only after Marco chooses Nimble as the task destination and the installed binary/profile check succeeds. Preserve the source skill's authorization and task-description requirements. This file does not authorize modifying the installed skill or Instinct.

1. Read `dt --json project list` and `dt --json label list`; resolve exact IDs. Read an existing task before updating it, retaining its description/context and complete label set.
2. Create the parent through `task create`; record its returned ID before creating each subtask with `--parent`. Pass due date/labels as first-class fields. Treat every successful child independently; if interrupted, read the parent's task list before resuming.
3. Read back returned IDs. A refresh warning does not permit duplicate creation. Report local creation and remote sync separately.
4. During the trial, Todoist remains a fallback only if Nimble is unavailable before any write and the existing Todoist workflow is authorized. After any success/partial result/uncertainty, reconcile Nimble first. Never write both destinations automatically.

Acceptance fixture: one synthetic parent and three subtasks with labels and due dates, visible in an already-running isolated app within one second. Web delivery within five minutes is a separate authorized integration gate.
