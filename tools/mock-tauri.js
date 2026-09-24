// mock-tauri.js — Tauri backend polyfill for running the nimble desktop
// app in a plain browser (vite dev server) with fully populated mock data.
// Inject via Playwright addInitScript BEFORE the app bundle loads.
//
// Today (in mock-world): Saturday, August 1, 2026.
// All field names are snake_case, matching @nimble/types (Rust structs).
(function () {
  'use strict'

  var TODAY = '2026-08-01'

  // ── Helpers ──────────────────────────────────────────────────────────────

  function iso(date, time) {
    return date + 'T' + (time || '09:00:00')
  }

  // Deterministic pseudo-random 0..1 from a string seed (for habit history)
  function hash01(str) {
    var h = 2166136261
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return ((h >>> 0) % 1000) / 1000
  }

  function daysAgo(n) {
    var d = new Date(2026, 7, 1) // Aug 1 2026, local
    d.setDate(d.getDate() - n)
    var m = String(d.getMonth() + 1).padStart(2, '0')
    var day = String(d.getDate()).padStart(2, '0')
    return d.getFullYear() + '-' + m + '-' + day
  }

  var idCounter = 1000
  function newId(prefix) {
    idCounter += 1
    return prefix + '-' + idCounter
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  var SETTINGS = {
    setup_complete: 'true',
    user_name: 'Marco',
    theme: 'light',
    heading_font: 'geist',
    body_font: 'geist',
    accent_theme: 'warm',
    obsidian_vault_path: '/Users/marcosevilla/Obsidian/marcowits',
    todoist_api_token: 'td-mock-token-000000',
    ical_feed_url: 'https://calendar.google.com/calendar/ical/marco/basic.ics',
    anthropic_api_key: 'sk-ant-mock-000000',
    focus_break_minutes: '10',
    focus_abandon_status: 'todo',
    turso_url: 'libsql://daily-triage-marco.turso.io',
    turso_token: 'turso-mock-token',
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  // R1 (schema v19): parent_id enables one-level project nesting; the
  // external/sync columns exist on every row (null for native projects).
  function project(o) {
    return Object.assign(
      {
        id: '',
        name: '',
        color: '#8b93a7',
        position: 0,
        parent_id: null,
        external_id: null,
        external_source: null,
        remote_updated_at: null,
        synced_snapshot: null,
      },
      o,
    )
  }

  var PROJECTS = [
    project({ id: 'inbox', name: 'Inbox', color: '#8b93a7', position: 0 }),
    project({ id: 'proj-portfolio', name: 'Portfolio', color: '#e2a33e', position: 1 }),
    project({ id: 'proj-taskapp', name: 'Nimble', color: '#5e6ad2', position: 2 }),
    project({ id: 'proj-mobile', name: 'Mobile app', color: '#26b5ce', position: 3, parent_id: 'proj-taskapp' }),
    project({ id: 'proj-photo', name: 'Photography', color: '#d46a9e', position: 4 }),
    project({ id: 'proj-life', name: 'Life Admin', color: '#4cb782', position: 5 }),
  ]

  // ── Labels (R1) ──────────────────────────────────────────────────────────
  // Colors are Todoist-style *names* (see apps/desktop/src/lib/labelColors.ts),
  // not hex values.

  var LABELS = [
    { id: 'label-deep-work', name: 'deep-work', color: 'blue', position: 0, created_at: iso('2026-07-20') },
    { id: 'label-design', name: 'design', color: 'grape', position: 1, created_at: iso('2026-07-20') },
    { id: 'label-bug', name: 'bug', color: 'red', position: 2, created_at: iso('2026-07-21') },
    { id: 'label-quick-win', name: 'quick-win', color: 'green', position: 3, created_at: iso('2026-07-22') },
    { id: 'label-errand', name: 'errand', color: 'orange', position: 4, created_at: iso('2026-07-25') },
  ]

  // ── Sections (R1): per-project lanes ─────────────────────────────────────

  var SECTIONS = [
    { id: 'sec-now', project_id: 'proj-taskapp', name: 'In progress', position: 0, external_id: null, external_source: null, created_at: iso('2026-07-28') },
    { id: 'sec-next', project_id: 'proj-taskapp', name: 'Up next', position: 1, external_id: null, external_source: null, created_at: iso('2026-07-28') },
  ]

  // ── Local tasks ──────────────────────────────────────────────────────────
  // priority: 1 = none, 2..4 ascending (4 = highest), matching PriorityBars.

  function task(o) {
    return Object.assign(
      {
        id: '',
        parent_id: null,
        content: '',
        description: null,
        project_id: 'inbox',
        priority: 1,
        due_date: null,
        due_time: null,
        duration_minutes: null,
        recurrence_rule: null,
        section_id: null,
        labels: [],
        completed: false,
        completed_at: null,
        status: 'todo',
        linked_doc_id: null,
        position: 0,
        created_at: iso(daysAgo(6), '10:15:00'),
        updated_at: iso(daysAgo(1), '18:40:00'),
        external_id: null,
        external_source: null,
        remote_updated_at: null,
        synced_snapshot: null,
      },
      o,
    )
  }

  var TASKS = [
    task({
      id: 'task-01',
      content: 'Refresh portfolio case study: Canary check-in redesign',
      description:
        'Rework the narrative around the mobile check-in flow. Lead with the 34% drop in front-desk calls, then walk through research, flows, and the final visual pass.',
      project_id: 'proj-portfolio',
      priority: 4,
      due_date: TODAY,
      labels: ['label-deep-work', 'label-design'],
      status: 'in_progress',
      position: 0,
    }),
    task({
      id: 'task-02',
      parent_id: 'task-01',
      content: 'Export final hero images for case study',
      project_id: 'proj-portfolio',
      priority: 3,
      due_date: TODAY,
      status: 'todo',
      position: 1,
    }),
    task({
      id: 'task-03',
      parent_id: 'task-01',
      content: 'Write process section (research → wireframes → ship)',
      project_id: 'proj-portfolio',
      priority: 2,
      status: 'todo',
      position: 2,
    }),
    task({
      id: 'task-04',
      content: 'Fix capture strip focus bug on second monitor',
      // R1 Task 12: descriptions are markdown-canonical.
      description:
        'The frameless capture window loses focus when summoned on the external display.\n\n' +
        '**Repro**\n\n' +
        '1. Figma fullscreen on monitor 2\n' +
        '2. Summon the strip with `⌥⌘Space`\n' +
        '3. Strip renders *without* keyboard focus\n\n' +
        'Likely the `NSPanel` activation policy — check `dismiss_capture_strip` logs first.',
      project_id: 'proj-taskapp',
      priority: 3,
      due_date: TODAY,
      due_time: '14:00',
      duration_minutes: 45,
      recurrence_rule: 'every week',
      section_id: 'sec-now',
      labels: ['label-bug', 'label-deep-work'],
      status: 'in_progress',
      position: 3,
    }),
    task({
      id: 'task-05',
      content: 'Ship v1.5: quick-capture polish',
      project_id: 'proj-taskapp',
      priority: 4,
      due_date: '2026-08-03',
      section_id: 'sec-now',
      labels: ['label-quick-win'],
      status: 'todo',
      position: 4,
    }),
    task({
      id: 'task-06',
      content: 'Design empty states for Goals page',
      project_id: 'proj-taskapp',
      priority: 2,
      section_id: 'sec-next',
      labels: ['label-design'],
      status: 'backlog',
      position: 5,
    }),
    task({
      id: 'task-07',
      content: 'Cull + edit Deftones set from The Fillmore',
      project_id: 'proj-photo',
      priority: 3,
      due_date: '2026-08-02',
      status: 'todo',
      position: 6,
    }),
    task({
      id: 'task-08',
      content: 'Deliver selects to band management',
      project_id: 'proj-photo',
      priority: 2,
      due_date: '2026-08-04',
      status: 'blocked',
      position: 7,
    }),
    task({
      id: 'task-09',
      content: 'Renew car registration',
      project_id: 'proj-life',
      priority: 3,
      due_date: TODAY,
      labels: ['label-errand', 'label-quick-win'],
      status: 'todo',
      position: 8,
    }),
    task({
      id: 'task-10',
      content: 'Book dentist appointment',
      project_id: 'proj-life',
      priority: 1,
      status: 'backlog',
      position: 9,
    }),
    task({
      id: 'task-11',
      content: 'Reply to Fillmore photo pass email',
      project_id: 'proj-photo',
      priority: 2,
      completed: true,
      completed_at: iso('2026-07-31', '16:22:00'),
      status: 'complete',
      position: 10,
    }),
    task({
      id: 'task-12',
      content: 'Update resume with Q2 launch metrics',
      project_id: 'proj-portfolio',
      priority: 2,
      status: 'backlog',
      position: 11,
    }),
    task({
      id: 'task-13',
      content: 'Pay quarterly estimated taxes',
      project_id: 'proj-life',
      priority: 4,
      due_date: '2026-07-31',
      completed: true,
      completed_at: iso('2026-07-31', '11:05:00'),
      status: 'complete',
      position: 12,
    }),
    task({
      id: 'task-14',
      content: 'Research pedalboard flight case options',
      project_id: 'inbox',
      priority: 1,
      status: 'todo',
      position: 13,
    }),
    task({
      id: 'task-15',
      content: 'Prototype AI priorities reveal animation',
      project_id: 'proj-taskapp',
      priority: 2,
      due_date: '2026-08-05',
      labels: ['label-design'],
      status: 'todo',
      position: 14,
    }),
    task({
      id: 'task-16',
      content: 'Wire up mobile sync pull on app foreground',
      project_id: 'proj-mobile',
      priority: 3,
      due_date: '2026-08-06',
      status: 'todo',
      position: 15,
    }),
    task({
      id: 'task-17',
      content: 'Test capture flow on iPhone simulator',
      project_id: 'proj-mobile',
      priority: 2,
      labels: ['label-quick-win'],
      status: 'backlog',
      position: 16,
    }),
  ]

  // ── Captures (native inbox) ──────────────────────────────────────────────

  var CAPTURES = [
    {
      id: 'cap-01',
      content: 'Idea: intensity heatmap view for habits, like GitHub contributions',
      source: 'quick',
      converted_to_task_id: null,
      routed_to: null,
      context: 'Figma',
      created_at: iso(TODAY, '08:41:00'),
    },
    {
      id: 'cap-02',
      content: 'Look up Fujifilm X-T5 firmware update before Saturday show',
      source: 'quick',
      converted_to_task_id: null,
      routed_to: null,
      context: 'Chrome',
      created_at: iso('2026-07-31', '21:18:00'),
    },
    {
      id: 'cap-03',
      content: 'Ask Jordan about the design offsite date',
      source: 'quick',
      converted_to_task_id: null,
      routed_to: null,
      context: 'Slack',
      created_at: iso('2026-07-31', '15:02:00'),
    },
    {
      id: 'cap-04',
      content: 'Lens rental for September tour — compare BorrowLenses vs LensRentals',
      source: 'quick',
      converted_to_task_id: null,
      routed_to: null,
      context: 'Chrome',
      created_at: iso('2026-07-30', '19:44:00'),
    },
    {
      id: 'cap-05',
      content: 'Try oklch() for the warm accent palette ramp',
      source: 'quick',
      converted_to_task_id: null,
      routed_to: null,
      context: null,
      created_at: iso('2026-07-30', '11:27:00'),
    },
    {
      id: 'cap-06',
      content: 'Gift idea for mom — that ceramics class in Berkeley',
      source: 'quick',
      converted_to_task_id: null,
      routed_to: null,
      context: null,
      created_at: iso('2026-07-29', '20:03:00'),
    },
  ]

  // ── Capture routes ───────────────────────────────────────────────────────

  // Prefixes carry the leading '/' — parseRoutePrefix (and validateRoutePrefix,
  // which every real route is created through) requires it. Found while
  // verifying Task 5 live: with a bare letter here, no "/x word" ever
  // matched a route in the browser harness.
  var CAPTURE_ROUTES = [
    {
      id: 'route-01',
      prefix: '/i',
      target_type: 'doc',
      doc_id: 'doc-ideas',
      label: 'Ideas',
      color: '#e2a33e',
      icon: 'lightbulb',
      position: 0,
      created_at: iso('2026-06-12'),
    },
    {
      id: 'route-02',
      prefix: '/t',
      target_type: 'task',
      doc_id: null,
      label: 'Task',
      color: '#5e6ad2',
      icon: 'check-square',
      position: 1,
      created_at: iso('2026-06-12'),
    },
    {
      id: 'route-03',
      prefix: '/p',
      target_type: 'doc',
      doc_id: 'doc-shotlist',
      label: 'Photo notes',
      color: '#d46a9e',
      icon: 'camera',
      position: 2,
      created_at: iso('2026-06-20'),
    },
  ]

  // ── Life areas / goals / milestones ─────────────────────────────────────

  var LIFE_AREAS = [
    { id: 'la-career', name: 'Career', color: '#5e6ad2', icon: '💼', position: 0, created_at: iso('2026-01-04') },
    { id: 'la-health', name: 'Health', color: '#4cb782', icon: '🫀', position: 1, created_at: iso('2026-01-04') },
    { id: 'la-creative', name: 'Creative', color: '#d46a9e', icon: '📷', position: 2, created_at: iso('2026-01-04') },
    { id: 'la-financial', name: 'Financial', color: '#e2a33e', icon: '💰', position: 3, created_at: iso('2026-01-04') },
  ]

  // GoalWithProgress — progress is 0..100 (GoalsPage renders `${progress}%`)
  var GOALS = [
    {
      id: 'goal-01',
      name: 'Ship portfolio v2',
      description: 'Three deep case studies, new visual identity, live by September.',
      status: 'active',
      life_area_id: 'la-career',
      start_date: '2026-05-01',
      target_date: '2026-09-15',
      color: '#5e6ad2',
      position: 0,
      created_at: iso('2026-05-01'),
      updated_at: iso('2026-07-30'),
      progress: 55,
      milestone_count: 4,
      milestone_completed: 2,
      task_count: 5,
      task_completed: 3,
    },
    {
      id: 'goal-02',
      name: 'Photograph 20 shows this year',
      description: 'Keep the concert photography muscle alive — 20 shows, 3 published galleries.',
      status: 'active',
      life_area_id: 'la-creative',
      start_date: '2026-01-01',
      target_date: '2026-12-31',
      color: '#d46a9e',
      position: 1,
      created_at: iso('2026-01-05'),
      updated_at: iso('2026-07-28'),
      progress: 65,
      milestone_count: 3,
      milestone_completed: 2,
      task_count: 4,
      task_completed: 2,
    },
    {
      id: 'goal-03',
      name: 'Run a 10k without stopping',
      description: null,
      status: 'active',
      life_area_id: 'la-health',
      start_date: '2026-04-01',
      target_date: '2026-10-01',
      color: '#4cb782',
      position: 2,
      created_at: iso('2026-04-01'),
      updated_at: iso('2026-07-25'),
      progress: 40,
      milestone_count: 4,
      milestone_completed: 1,
      task_count: 0,
      task_completed: 0,
    },
    {
      id: 'goal-04',
      name: 'Six-month emergency fund',
      description: 'Automate transfers, stop checking the market every day.',
      status: 'active',
      life_area_id: 'la-financial',
      start_date: '2026-02-01',
      target_date: '2026-12-31',
      color: '#e2a33e',
      position: 3,
      created_at: iso('2026-02-01'),
      updated_at: iso('2026-07-15'),
      progress: 70,
      milestone_count: 3,
      milestone_completed: 2,
      task_count: 1,
      task_completed: 1,
    },
  ]

  var MILESTONES = {
    'goal-01': [
      { id: 'ms-01', goal_id: 'goal-01', name: 'Pick the three case studies', target_date: '2026-05-15', completed: true, completed_at: iso('2026-05-12'), position: 0, created_at: iso('2026-05-01') },
      { id: 'ms-02', goal_id: 'goal-01', name: 'Draft Canary check-in case study', target_date: '2026-08-05', completed: true, completed_at: iso('2026-07-29'), position: 1, created_at: iso('2026-05-01') },
      { id: 'ms-03', goal_id: 'goal-01', name: 'New visual identity + typography', target_date: '2026-08-20', completed: false, completed_at: null, position: 2, created_at: iso('2026-05-01') },
      { id: 'ms-04', goal_id: 'goal-01', name: 'Launch on new domain', target_date: '2026-09-15', completed: false, completed_at: null, position: 3, created_at: iso('2026-05-01') },
    ],
    'goal-02': [
      { id: 'ms-05', goal_id: 'goal-02', name: '10 shows photographed', target_date: '2026-06-30', completed: true, completed_at: iso('2026-06-21'), position: 0, created_at: iso('2026-01-05') },
      { id: 'ms-06', goal_id: 'goal-02', name: 'Publish Fillmore gallery', target_date: '2026-08-10', completed: true, completed_at: iso('2026-07-27'), position: 1, created_at: iso('2026-01-05') },
      { id: 'ms-07', goal_id: 'goal-02', name: '20 shows photographed', target_date: '2026-12-15', completed: false, completed_at: null, position: 2, created_at: iso('2026-01-05') },
    ],
    'goal-03': [
      { id: 'ms-08', goal_id: 'goal-03', name: 'Run 3k without stopping', target_date: '2026-05-15', completed: true, completed_at: iso('2026-05-20'), position: 0, created_at: iso('2026-04-01') },
      { id: 'ms-09', goal_id: 'goal-03', name: 'Run 5k without stopping', target_date: '2026-07-15', completed: false, completed_at: null, position: 1, created_at: iso('2026-04-01') },
      { id: 'ms-10', goal_id: 'goal-03', name: 'Run 8k', target_date: '2026-09-01', completed: false, completed_at: null, position: 2, created_at: iso('2026-04-01') },
      { id: 'ms-11', goal_id: 'goal-03', name: 'Race day: Golden Gate 10k', target_date: '2026-10-01', completed: false, completed_at: null, position: 3, created_at: iso('2026-04-01') },
    ],
    'goal-04': [
      { id: 'ms-12', goal_id: 'goal-04', name: 'Set up automatic transfers', target_date: '2026-02-15', completed: true, completed_at: iso('2026-02-10'), position: 0, created_at: iso('2026-02-01') },
      { id: 'ms-13', goal_id: 'goal-04', name: '3 months saved', target_date: '2026-06-30', completed: true, completed_at: iso('2026-06-28'), position: 1, created_at: iso('2026-02-01') },
      { id: 'ms-14', goal_id: 'goal-04', name: '6 months saved', target_date: '2026-12-31', completed: false, completed_at: null, position: 2, created_at: iso('2026-02-01') },
    ],
  }

  // ── Habits ───────────────────────────────────────────────────────────────

  var HABITS = [
    { id: 'habit-gym', name: 'Gym', category: 'Health', icon: 'dumbbell', color: '#4cb782', active: true, position: 0, created_at: iso('2026-01-06'), rate: 0.55 },
    { id: 'habit-read', name: 'Read', category: 'Learning', icon: 'book-open', color: '#5e6ad2', active: true, position: 1, created_at: iso('2026-01-06'), rate: 0.7 },
    { id: 'habit-journal', name: 'Journal', category: 'Personal', icon: 'pen-line', color: '#e2a33e', active: true, position: 2, created_at: iso('2026-02-10'), rate: 0.6 },
    { id: 'habit-walk', name: 'Walk', category: 'Health', icon: 'footprints', color: '#d46a9e', active: true, position: 3, created_at: iso('2026-03-02'), rate: 0.8 },
  ]

  // Deterministic: did `habit` get logged on `date`, and at what intensity?
  function habitDone(habitId, date) {
    var h = HABITS.find(function (x) { return x.id === habitId })
    return hash01(habitId + '|' + date) < (h ? h.rate : 0.5)
  }
  function habitIntensity(habitId, date) {
    return 1 + Math.floor(hash01('int|' + habitId + '|' + date) * 5) // 1..5
  }

  function buildHabitLogs(habitId, days) {
    var logs = []
    var ids = habitId ? [habitId] : HABITS.map(function (h) { return h.id })
    for (var d = 0; d < (days || 90); d++) {
      var date = daysAgo(d)
      ids.forEach(function (hid) {
        if (habitDone(hid, date)) {
          logs.push({
            id: 'hlog-' + hid + '-' + date,
            habit_id: hid,
            date: date,
            intensity: habitIntensity(hid, date),
            created_at: iso(date, '21:30:00'),
          })
        }
      })
    }
    return logs
  }

  function buildHeatmap(habitId, days) {
    var out = []
    for (var d = (days || 140) - 1; d >= 0; d--) {
      var date = daysAgo(d)
      var intensity = 0
      if (habitId) {
        if (habitDone(habitId, date)) intensity = habitIntensity(habitId, date)
      } else {
        // aggregate: number of habits done that day mapped onto 0..4-ish
        intensity = HABITS.filter(function (h) { return habitDone(h.id, date) }).length
      }
      out.push({ date: date, intensity: intensity })
    }
    return out
  }

  function habitMomentum(habitId) {
    // % of last 14 days logged → 0..100
    var n = 0
    for (var d = 0; d < 14; d++) if (habitDone(habitId, daysAgo(d))) n++
    return Math.round((n / 14) * 100)
  }

  function habitsWithStats() {
    return HABITS.map(function (h) {
      var doneToday = habitDone(h.id, TODAY)
      return {
        id: h.id,
        name: h.name,
        category: h.category,
        icon: h.icon,
        color: h.color,
        active: h.active,
        position: h.position,
        created_at: h.created_at,
        current_momentum: habitMomentum(h.id),
        today_completed: doneToday,
        today_intensity: doneToday ? habitIntensity(h.id, TODAY) : 0,
      }
    })
  }

  // ── Docs ─────────────────────────────────────────────────────────────────

  var DOC_FOLDERS = [
    { id: 'folder-design', name: 'Design', position: 0, created_at: iso('2026-05-02') },
    { id: 'folder-photo', name: 'Photography', position: 1, created_at: iso('2026-05-02') },
    { id: 'folder-personal', name: 'Personal', position: 2, created_at: iso('2026-06-11') },
  ]

  var DOCUMENTS = [
    {
      id: 'doc-ideas',
      title: 'Ideas',
      content:
        '<h2>App ideas</h2><ul><li><p>Habit intensity heatmap — GitHub-contributions style, warm ramp</p></li><li><p>Command-K action for "route capture to doc"</p></li><li><p>Weekly review mode that reuses the morning review shell</p></li></ul><p>Keep this list short. Ship one before adding three.</p>',
      folder_id: 'folder-design',
      position: 0,
      created_at: iso('2026-06-12'),
      updated_at: iso('2026-07-30', '22:14:00'),
    },
    {
      id: 'doc-case-study',
      title: 'Canary check-in case study — outline',
      content:
        '<h1>Mobile check-in redesign</h1><p><strong>Hook:</strong> front-desk calls dropped 34% after launch.</p><h2>Structure</h2><ol><li><p>Problem: kiosk-era flow on mobile screens</p></li><li><p>Research: 12 guest interviews, session replays</p></li><li><p>Explorations: three directions, why we picked the boarding-pass model</p></li><li><p>Ship + results</p></li></ol><blockquote><p>Keep it under a 6-minute read.</p></blockquote>',
      folder_id: 'folder-design',
      position: 1,
      created_at: iso('2026-07-18'),
      updated_at: iso('2026-07-31', '17:45:00'),
    },
    {
      id: 'doc-shotlist',
      title: 'Fillmore shot list',
      content:
        '<h2>Deftones @ The Fillmore</h2><ul><li><p>Wide from the balcony during the opener</p></li><li><p>Chino at the mic, red wash, 85mm</p></li><li><p>Crowd surfers from the pit (first three songs only)</p></li></ul><p>Settings: 1/250, f/1.8, auto-ISO capped at 6400.</p>',
      folder_id: 'folder-photo',
      position: 0,
      created_at: iso('2026-07-24'),
      updated_at: iso('2026-07-29', '13:20:00'),
    },
    {
      id: 'doc-packing',
      title: 'Gig bag checklist',
      content:
        '<ul><li><p>X-T5 + 23mm + 56mm</p></li><li><p>Spare batteries ×3, dual charger</p></li><li><p>Earplugs (the good ones)</p></li><li><p>Photo pass lanyard</p></li></ul>',
      folder_id: 'folder-photo',
      position: 1,
      created_at: iso('2026-06-30'),
      updated_at: iso('2026-07-20'),
    },
    {
      id: 'doc-japan',
      title: 'Japan trip notes',
      content:
        '<h2>October trip</h2><p>Tokyo (4 nights) → Kyoto (3) → Osaka (2).</p><ul><li><p>Book Shinkansen passes before September</p></li><li><p>Camera walk: Shibuya at blue hour</p></li></ul>',
      folder_id: 'folder-personal',
      position: 0,
      created_at: iso('2026-07-05'),
      updated_at: iso('2026-07-26'),
    },
  ]

  var DOC_NOTES = {
    'doc-ideas': [
      { id: 'note-01', doc_id: 'doc-ideas', content: 'oklch ramp works — hue 55, chroma 0.13 across steps', position: 0, created_at: iso('2026-07-30', '22:10:00') },
      { id: 'note-02', doc_id: 'doc-ideas', content: 'Heatmap idea got a thumbs up from Jordan', position: 1, created_at: iso('2026-07-31', '10:05:00') },
    ],
    'doc-case-study': [
      { id: 'note-03', doc_id: 'doc-case-study', content: 'Ask marketing for the launch-week metrics screenshot', position: 0, created_at: iso('2026-07-31', '17:48:00') },
    ],
  }

  // ── Calendar ─────────────────────────────────────────────────────────────

  var CALENDAR_FEEDS = [
    { id: 'feed-personal', label: 'Personal', url: 'https://calendar.google.com/calendar/ical/marco/basic.ics', color: '#5e6ad2', enabled: 1 },
    { id: 'feed-shows', label: 'Shows', url: 'https://calendar.google.com/calendar/ical/shows/basic.ics', color: '#d46a9e', enabled: 1 },
  ]

  var CALENDAR_EVENTS = [
    {
      id: 'evt-01',
      summary: 'Morning run — Marina loop',
      description: null,
      location: 'Marina Green',
      start_time: iso(TODAY, '08:30:00'),
      end_time: iso(TODAY, '09:15:00'),
      all_day: false,
      meeting_url: null,
      date: TODAY,
      feed_label: 'Personal',
      feed_color: '#5e6ad2',
    },
    {
      id: 'evt-02',
      summary: 'Portfolio work block',
      description: 'Case study draft — no phone',
      location: null,
      start_time: iso(TODAY, '10:00:00'),
      end_time: iso(TODAY, '12:30:00'),
      all_day: false,
      meeting_url: null,
      date: TODAY,
      feed_label: 'Personal',
      feed_color: '#5e6ad2',
    },
    {
      id: 'evt-03',
      summary: 'Coffee with Jordan',
      description: null,
      location: 'Sightglass, SoMa',
      start_time: iso(TODAY, '14:00:00'),
      end_time: iso(TODAY, '15:00:00'),
      all_day: false,
      meeting_url: null,
      date: TODAY,
      feed_label: 'Personal',
      feed_color: '#5e6ad2',
    },
    {
      id: 'evt-04',
      summary: 'Turnstile @ The Warfield — photo pass',
      description: 'Pit access first three songs. Doors 7pm.',
      location: 'The Warfield, San Francisco',
      start_time: iso(TODAY, '19:00:00'),
      end_time: iso(TODAY, '23:00:00'),
      all_day: false,
      meeting_url: null,
      date: TODAY,
      feed_label: 'Shows',
      feed_color: '#d46a9e',
    },
  ]

  // ── Todoist (raw rows: integer booleans) ─────────────────────────────────

  var TODOIST_TASKS = [
    { id: 'td-01', content: 'Submit expense report for July', description: null, project_id: 'td-proj-work', project_name: 'Work', priority: 3, due_date: TODAY, due_is_recurring: 0, is_completed: 0, todoist_url: 'https://todoist.com/showTask?id=td-01' },
    { id: 'td-02', content: 'Water the plants', description: null, project_id: 'td-proj-home', project_name: 'Home', priority: 1, due_date: TODAY, due_is_recurring: 1, is_completed: 0, todoist_url: 'https://todoist.com/showTask?id=td-02' },
    { id: 'td-03', content: 'Order replacement camera strap', description: 'Peak Design Slide Lite, black', project_id: 'td-proj-photo', project_name: 'Photo gear', priority: 2, due_date: '2026-08-03', due_is_recurring: 0, is_completed: 0, todoist_url: 'https://todoist.com/showTask?id=td-03' },
    { id: 'td-04', content: 'Call landlord about the leaky faucet', description: null, project_id: 'td-proj-home', project_name: 'Home', priority: 4, due_date: TODAY, due_is_recurring: 0, is_completed: 0, todoist_url: 'https://todoist.com/showTask?id=td-04' },
    { id: 'td-05', content: 'Review design system PR feedback', description: null, project_id: 'td-proj-work', project_name: 'Work', priority: 3, due_date: '2026-08-04', due_is_recurring: 0, is_completed: 0, todoist_url: 'https://todoist.com/showTask?id=td-05' },
  ]

  // ── Daily state / priorities ─────────────────────────────────────────────

  var DAILY_STATE = {
    date: TODAY,
    energy_level: 'high',
    priorities: [
      {
        title: 'Finish the case study draft during the morning work block',
        source: 'Portfolio · task',
        reasoning: 'High energy plus a protected 10am block — deep work goes first. The Sept 15 launch depends on this draft.',
      },
      {
        title: 'Renew car registration before the DMV portal closes',
        source: 'Life Admin · due today',
        reasoning: 'Due today and takes 10 minutes online. Knock it out after the run so it stops taking up mental space.',
      },
      {
        title: 'Prep camera bag for the Turnstile show',
        source: 'Calendar · tonight',
        reasoning: 'Doors at 7pm. Batteries charging and cards formatted by late afternoon means no scramble at 6.',
      },
    ],
    review_complete: true,
  }

  // ?review=open forces the first-open guided review flow (audit screenshots).
  try {
    if (new URLSearchParams(window.location.search).get('review') === 'open') {
      DAILY_STATE.review_complete = false
    }
  } catch (e) { /* noop */ }

  // ── Briefs (morning brief phase 1) ───────────────────────────────────────
  // Field names/shape mirror nimble-core's Brief + BriefSnapshotV1
  // (nimble-core/src/db/briefs.rs). Keyed by date, newest-first is computed
  // by brief_list_dates, not by insertion order here.

  var BRIEFS = {
    '2026-07-31': {
      date: '2026-07-31',
      version: 1,
      status: 'ready',
      source: 'nimble',
      layout: ['schedule', 'priorities', 'due_today', 'still_open', 'vault'],
      snapshot: {
        schedule: {
          events: [
            {
              id: 'evt-past-01',
              summary: 'Portfolio review with Jordan',
              description: null,
              location: null,
              start_time: iso('2026-07-31', '10:00:00'),
              end_time: iso('2026-07-31', '11:00:00'),
              all_day: false,
              meeting_url: null,
              date: '2026-07-31',
              feed_label: 'Personal',
              feed_color: '#5e6ad2',
            },
            {
              id: 'evt-past-02',
              summary: 'Dentist appointment',
              description: null,
              location: 'SoMa Dental',
              start_time: iso('2026-07-31', '15:30:00'),
              end_time: iso('2026-07-31', '16:15:00'),
              all_day: false,
              meeting_url: null,
              date: '2026-07-31',
              feed_label: 'Personal',
              feed_color: '#5e6ad2',
            },
          ],
          tomorrow: [],
        },
        priorities: [
          {
            title: 'Send the Canary case study draft to Jordan for feedback',
            source: 'Portfolio · task',
            reasoning: 'Review is booked for 10am — send it the night before so there is time to read.',
          },
          {
            title: 'Confirm the Turnstile photo pass',
            source: 'Calendar · this week',
            reasoning: 'Door list closes Friday; a quick email now avoids a scramble later.',
          },
          {
            title: 'Pay the storage unit invoice',
            source: 'Life Admin · due today',
            reasoning: 'Autopay lapsed last month — a manual payment keeps the account current.',
          },
        ],
        due_today: [
          { id: 'task-past-01', content: 'Pay the storage unit invoice', due_date: '2026-07-31', priority: 3, project_id: 'proj-life' },
          { id: 'task-past-02', content: 'Send case study draft to Jordan', due_date: '2026-07-31', priority: 4, project_id: 'proj-portfolio' },
        ],
        still_open: {
          total: 4,
          oldest: [
            { id: 'task-past-03', content: 'Renew passport', due_date: '2026-07-10', priority: 2, project_id: 'proj-life' },
            { id: 'task-past-04', content: 'Back up old hard drive', due_date: '2026-07-18', priority: 1, project_id: 'proj-taskapp' },
            { id: 'task-past-05', content: 'Reply to venue about Nov booking', due_date: '2026-07-25', priority: 2, project_id: 'proj-photo' },
          ],
        },
      },
      snapshot_schema: 1,
      generated_at: '2026-07-31 07:05:00',
      updated_at: '2026-07-31 07:05:00',
    },
  }

  function briefTaskRef(t) {
    return { id: t.id, content: t.content, due_date: t.due_date, priority: t.priority, project_id: t.project_id }
  }

  // ── Obsidian today.md ────────────────────────────────────────────────────

  var TODAY_MD = {
    tasks: [
      { line_number: 4, checked: true, text: 'Morning pages' },
      { line_number: 5, checked: false, text: 'Case study work block' },
      { line_number: 6, checked: false, text: 'Charge camera batteries' },
    ],
    habits_core: [
      { line_number: 10, checked: true, text: 'Run' },
      { line_number: 11, checked: false, text: 'Read 20 min' },
      { line_number: 12, checked: false, text: 'Journal' },
    ],
    habits_bonus: [
      { line_number: 16, checked: false, text: 'Stretch' },
      { line_number: 17, checked: true, text: '10k steps' },
    ],
  }

  // ── Reminders / Google Calendar (C2) ──────────────────────────────────

  var REMINDER_STATUS = { permission: 'granted', timezone: 'America/Los_Angeles', errorCode: null }

  var REMINDER_CATCH_UP = [
    {
      occurrenceKey: 'task-05@' + iso(TODAY, '09:00:00'),
      taskId: 'task-05',
      title: 'Ship v1.5: quick-capture polish',
      scheduledAt: iso(TODAY, '09:00:00'),
      errorCode: null,
    },
    {
      occurrenceKey: 'task-06@needs-attention',
      taskId: 'task-06',
      title: 'Design empty states for Goals page',
      scheduledAt: iso(TODAY, '00:00:00'),
      errorCode: 'schedule_needs_attention',
    },
  ]
  var ACKNOWLEDGED = {}

  // Fresh install: OAuth client not configured, nothing connected.
  var GOOGLE_STATUS = {
    connected: false,
    clientSecretConfigured: false,
    calendarLabel: null,
    timezone: 'America/Los_Angeles',
    errorCode: null,
  }

  // ── Obsidian vault notes (12 of the 1,104 indexed) ───────────────────

  function vaultNote(o) {
    var fm = '---\n' + Object.keys(o.frontmatter).map(function (k) {
      var v = o.frontmatter[k]
      return k + ': ' + (Array.isArray(v) ? '[' + v.join(', ') + ']' : v)
    }).join('\n') + '\n---\n\n'
    return {
      id: o.id,
      path: o.path,
      title: o.title,
      frontmatter: o.frontmatter,
      content: fm + o.body,
      updated_at: o.updated_at,
    }
  }

  var VAULT_NOTES = [
    vaultNote({
      id: 'vault-001', path: 'journal/2026-08-01.md', title: '2026-08-01',
      frontmatter: { type: 'daily', tags: ['journal'], energy: 7 },
      updated_at: iso(TODAY, '07:52:00'),
      body: '# Saturday, August 1\n\nSlow start, coffee on the stoop. Long run this morning before it gets hot.\n\n## Intentions\n\n- [ ] Case study work block — [[Canary check-in case study]]\n- [ ] Charge camera batteries for [[Turnstile at the Warfield]]\n- [x] Morning pages\n\n## Notes\n\nRe-read [[Design principles]] before the portfolio pass. The empty-states thinking from [[Goals page empty states]] applies to the case study intro too.\n',
    }),
    vaultNote({
      id: 'vault-002', path: 'projects/Canary check-in case study.md', title: 'Canary check-in case study',
      frontmatter: { type: 'project', status: 'active', tags: ['portfolio', 'design'] },
      updated_at: iso('2026-07-30', '16:10:00'),
      body: '# Canary check-in case study\n\nRework the narrative around the mobile check-in flow.\n\n## Outline\n\n1. Lead with the outcome: **34% drop in front-desk calls**\n2. Research — 12 front-desk interviews, 3 hotels\n3. Flows — arrival, ID capture, room-ready notification\n4. Visual pass — see [[Design principles]]\n\n## Open questions\n\n- How much of the metrics story can be shared publicly?\n- Pair with [[Portfolio site rebuild]] timeline\n',
    }),
    vaultNote({
      id: 'vault-003', path: 'resources/Design principles.md', title: 'Design principles',
      frontmatter: { type: 'reference', tags: ['design', 'craft'] },
      updated_at: iso('2026-07-12', '11:30:00'),
      body: '# Design principles\n\nWorking list, revised whenever something bites.\n\n- **No guilt UI.** Neutral framing for overdue work; never shame.\n- **One decision per screen.** Batch choices, reduce overhead.\n- **Keyboard first, mouse welcome.**\n- **Warm, not loud.** Muted palette, one accent.\n\nApplied in [[Canary check-in case study]] and the [[Nimble]] roadmap.\n',
    }),
    vaultNote({
      id: 'vault-004', path: 'projects/Nimble.md', title: 'Nimble',
      frontmatter: { type: 'project', status: 'active', tags: ['code', 'adhd'] },
      updated_at: iso('2026-07-31', '22:05:00'),
      body: '# Nimble\n\nDaily triage app. Todoist replacement decisions are locked — see [[Todoist replacement decisions]].\n\n## This week\n\n- [ ] C1 safety net: backups + export\n- [ ] Mock 7 Figma surfaces\n- [ ] Task-detail inline editors\n\n## Principles\n\nPulls from [[Design principles]]. Empty states per [[Goals page empty states]].\n',
    }),
    vaultNote({
      id: 'vault-005', path: 'projects/Todoist replacement decisions.md', title: 'Todoist replacement decisions',
      frontmatter: { type: 'decision', date: '2026-08-25', tags: ['nimble'] },
      updated_at: iso('2026-07-29', '14:40:00'),
      body: '# Todoist replacement decisions\n\nR1–R5 retired for C1–C5.\n\n| Track | Scope | Hours |\n| --- | --- | --- |\n| C1 | Backups / export | 6 |\n| C2 | Reminders via Google Calendar OAuth | 10 |\n| C3 | `dt` CLI | 5 |\n\nTodoist downgrades to free at cutover — never cancels. Context in [[Nimble]].\n',
    }),
    vaultNote({
      id: 'vault-006', path: 'photography/Turnstile at the Warfield.md', title: 'Turnstile at the Warfield',
      frontmatter: { type: 'gig', date: '2026-08-01', venue: 'The Warfield', tags: ['photo', 'concert'] },
      updated_at: iso('2026-07-31', '18:20:00'),
      body: '# Turnstile at the Warfield\n\nDoors 7pm, photo pit first three songs.\n\n## Kit\n\n- [ ] Two bodies, 24-70 + 70-200\n- [ ] Batteries charged\n- [ ] Cards formatted\n\nDeliver edits by Monday per [[Photo delivery checklist]].\n',
    }),
    vaultNote({
      id: 'vault-007', path: 'photography/Photo delivery checklist.md', title: 'Photo delivery checklist',
      frontmatter: { type: 'checklist', tags: ['photo', 'process'] },
      updated_at: iso('2026-06-18', '09:15:00'),
      body: '# Photo delivery checklist\n\n1. Cull in Photo Mechanic\n2. Edit in Lightroom, export 2048px\n3. Watermark + renumber\n4. Upload gallery, send link\n\nUsed after every gig — most recently [[Turnstile at the Warfield]].\n',
    }),
    vaultNote({
      id: 'vault-008', path: 'resources/Goals page empty states.md', title: 'Goals page empty states',
      frontmatter: { type: 'research', tags: ['design', 'nimble'] },
      updated_at: iso('2026-07-22', '13:05:00'),
      body: '# Goals page empty states\n\nPositive, forward-looking copy. Never "you have no goals".\n\n- "Pick one thing to move this quarter."\n- Show a single primary action, not a grid of options.\n\nInformed by [[Design principles]]; ships in [[Nimble]].\n',
    }),
    vaultNote({
      id: 'vault-009', path: 'projects/Portfolio site rebuild.md', title: 'Portfolio site rebuild',
      frontmatter: { type: 'project', status: 'paused', tags: ['portfolio'] },
      updated_at: iso('2026-07-08', '10:00:00'),
      body: '# Portfolio site rebuild\n\nAstro + MDX. Paused until [[Canary check-in case study]] is written.\n\n## Pages\n\n- Home\n- Work (case studies)\n- Photo\n- About\n',
    }),
    vaultNote({
      id: 'vault-010', path: 'journal/2026-07-31.md', title: '2026-07-31',
      frontmatter: { type: 'daily', tags: ['journal'], energy: 5 },
      updated_at: iso('2026-07-31', '21:48:00'),
      body: '# Friday, July 31\n\nPaid the quarterly taxes, replied to the Fillmore pass email. Low energy afternoon.\n\n- [x] Taxes\n- [x] Fillmore reply\n- [ ] Case study outline — pushed to [[2026-08-01]]\n',
    }),
    vaultNote({
      id: 'vault-011', path: 'resources/Job hunt direction.md', title: 'Job hunt direction',
      frontmatter: { type: 'note', tags: ['career'], updated: '2026-07-28' },
      updated_at: iso('2026-07-28', '17:33:00'),
      body: '# Job hunt direction\n\nSenior IC product design at a creative-tools company, photo- or music-adjacent.\n\n## Signals\n\n- Design-led, a head of design to learn from\n- AI-forward but not AI-only\n\nPortfolio depends on [[Canary check-in case study]].\n',
    }),
    vaultNote({
      id: 'vault-012', path: 'inbox/Quick capture 2026-07-30.md', title: 'Quick capture 2026-07-30',
      frontmatter: { type: 'capture', tags: ['inbox'] },
      updated_at: iso('2026-07-30', '08:12:00'),
      body: '# Quick capture 2026-07-30\n\n- Idea: keyboard-only triage for the inbox — see [[Nimble]]\n- Book: *Show Your Work*\n- Call the dentist\n',
    }),
  ]

  function findVaultNote(path) {
    if (!path) return null
    var p = String(path).toLowerCase()
    return VAULT_NOTES.filter(function (n) {
      return n.path.toLowerCase() === p || n.id === path
    })[0] || null
  }

  function vaultSummary(n) {
    return { id: n.id, path: n.path, title: n.title, updated_at: n.updated_at }
  }

  function vaultDetail(n) {
    return {
      id: n.id,
      path: n.path,
      title: n.title,
      content: n.content,
      frontmatter_json: JSON.stringify(n.frontmatter),
      mtime: n.updated_at,
      size: n.content.length,
      hash: 'sha256:' + String(hash01(n.content)).slice(2, 10).padEnd(8, '0') + 'f0e1d2c3',
      updated_at: n.updated_at,
      deleted_at: null,
    }
  }

  // ── Activity log ─────────────────────────────────────────────────────────

  var ACTIVITY_LOG = [
    { id: 'act-01', action_type: 'task_completed', target_id: 'task-13', metadata: { content: 'Pay quarterly estimated taxes' }, created_at: iso('2026-07-31', '11:05:00') },
    { id: 'act-02', action_type: 'task_completed', target_id: 'task-11', metadata: { content: 'Reply to Fillmore photo pass email' }, created_at: iso('2026-07-31', '16:22:00') },
    { id: 'act-03', action_type: 'status_changed', target_id: 'task-01', metadata: { content: 'Refresh portfolio case study: Canary check-in redesign', old_status: 'todo', new_status: 'in_progress' }, created_at: iso(TODAY, '09:12:00') },
    { id: 'act-04', action_type: 'capture_created', target_id: 'cap-01', metadata: null, created_at: iso(TODAY, '08:41:00') },
    { id: 'act-05', action_type: 'habit_logged', target_id: 'habit-walk', metadata: { date: TODAY }, created_at: iso(TODAY, '09:20:00') },
    { id: 'act-06', action_type: 'task_created', target_id: 'task-15', metadata: { content: 'Prototype AI priorities reveal animation' }, created_at: iso('2026-07-30', '14:55:00') },
  ]

  var ACTIVITY_SUMMARY = [
    { action_type: 'task_completed', count: 2 },
    { action_type: 'status_changed', count: 1 },
    { action_type: 'capture_created', count: 1 },
    { action_type: 'habit_logged', count: 1 },
  ]

  // ── Briefs / session log ─────────────────────────────────────────────────

  var DAILY_BRIEF =
    '# Daily Brief — Saturday, August 1, 2026\n\n' +
    '## Weather\nSunny, 68°F in San Francisco. Fog burns off by 10am.\n\n' +
    '## Schedule\n- 8:30 Morning run (Marina loop)\n- 10:00 Portfolio work block\n- 14:00 Coffee with Jordan\n- 19:00 Turnstile @ The Warfield (photo pass)\n\n' +
    '## Open threads\n- Car registration is due today — 10 min online\n- Band management is waiting on Fillmore selects (contract pending)\n\n' +
    '## One thing\nIf only one thing happens today, make it the case study draft.\n'

  var SESSION_LOG =
    '## Session — 2026-07-31\n\n' +
    '**Completed:** Fillmore photo pass reply, quarterly taxes\n\n' +
    '**Open:** Case study draft (hero images pending), capture strip focus bug\n\n' +
    '**Deferred:** Resume update — parked until case study ships\n'

  // ── Command map ──────────────────────────────────────────────────────────

  function findTask(id) {
    return TASKS.find(function (t) { return t.id === id }) || null
  }

  var backupScenario = new URLSearchParams(window.location.search).get('backup') || 'local'
  var backupMock = {
    running: backupScenario === 'working', disabled_reason: null,
    last_local_success_at: backupScenario === 'empty' ? null : '2026-09-21T09:00:00Z',
    last_push_at: backupScenario === 'uploaded' ? '2026-09-21T09:01:00Z' : null,
    export_commit: backupScenario === 'uploaded' ? '0123456789abcdef' : null,
    backup_directory: '/synthetic/Nimble/backups', retained_count: backupScenario === 'empty' ? 0 : 5,
    remote_configured: ['uploaded', 'pending', 'error'].indexOf(backupScenario) >= 0,
    remote_name: 'example/private-backups',
    turso_pending: backupScenario === 'unavailable' ? null : 0,
    todoist_pending: backupScenario === 'unavailable' ? null : 0,
    todoist_failed: backupScenario === 'unavailable' ? null : 0,
    restore_activation_required: backupScenario === 'restored',
    error: backupScenario === 'error' ? { stage: 'publish', code: 'offline', at: '2026-09-21T09:00:00Z' } : null,
  }
  var commands = {
    backup_get_status: function () { return Object.assign({}, backupMock) },
    backup_run_now: function () { backupMock.last_local_success_at = new Date().toISOString(); return Object.assign({}, backupMock) },
    backup_verify_latest: function () { return { verified: true } },
    backup_activate_restored_profile: function () { backupMock.restore_activation_required = false; return Object.assign({}, backupMock) },
    backup_open_folder: function () { return null },
    backup_configure_remote: function (args) { backupMock.remote_configured = true; backupMock.remote_name = args.ownerRepo; return Object.assign({}, backupMock) },
    // Settings
    check_setup_complete: function () { return true },
    get_setting: function (args) {
      var v = SETTINGS[args && args.key]
      return v === undefined ? null : v
    },
    set_setting: function () { return null },
    get_all_settings: function () {
      return Object.keys(SETTINGS).map(function (k) { return { key: k, value: SETTINGS[k] } })
    },
    clear_all_settings: function () { return null },

    // Obsidian
    read_today_md: function () { return TODAY_MD },
    toggle_obsidian_checkbox: function () { return TODAY_MD },

    // Todoist
    fetch_todoist_tasks: function () { return TODOIST_TASKS },
    refresh_todoist_tasks: function () { return TODOIST_TASKS },
    complete_todoist_task: function () { return null },
    snooze_todoist_task: function () { return null },
    preview_todoist_migration: function () {
      return {
        projects_to_create: 3,
        projects_already_migrated: 0,
        tasks_to_create: 5,
        tasks_already_migrated: 0,
        sections_count: 2,
        tasks_with_labels: 1,
        tasks_recurring: 1,
        tasks_with_subtasks: 0,
        project_names_preview: ['Work', 'Home', 'Photo gear'],
      }
    },
    migrate_todoist: function () {
      return { projects_created: 3, projects_updated: 0, tasks_created: 5, tasks_updated: 0, recurring_preserved: 1, labels_preserved: 1, errors: [] }
    },
    migrated_todoist_ids: function () { return [] },

    // Calendar
    fetch_calendar_events: function () { return CALENDAR_EVENTS },
    get_cached_calendar_events: function (args) {
      // Only "today" has events in mock-world; other dates render empty states
      if (args && args.date && args.date !== TODAY) return []
      return CALENDAR_EVENTS
    },
    get_calendar_feeds: function () { return CALENDAR_FEEDS },
    add_calendar_feed: function (args) {
      return { id: newId('feed'), label: args.label, url: args.url, color: args.color, enabled: 1 }
    },
    remove_calendar_feed: function () { return null },

    // Session log / briefs / quick captures
    read_session_log: function () { return SESSION_LOG },
    read_daily_brief: function () { return DAILY_BRIEF },
    list_brief_dates: function () { return [TODAY, '2026-07-31', '2026-07-30', '2026-07-29'] },
    read_quick_captures: function () {
      return [
        { timestamp: '2026-07-28 09:14', content: 'Legacy capture: try the new Linear board layout' },
        { timestamp: '2026-07-27 18:40', content: 'Legacy capture: SFMOMA photo exhibit closes Aug 9' },
      ]
    },
    write_quick_capture: function (args) {
      return { timestamp: TODAY + ' 09:00', content: (args && args.content) || '' }
    },

    // Daily state / AI priorities
    get_daily_state: function () { return DAILY_STATE },
    generate_priorities: function () { return DAILY_STATE.priorities },

    // Morning brief (phase 1)
    brief_get: function (args) { return BRIEFS[args && args.date] || null },
    brief_list_dates: function () {
      return Object.keys(BRIEFS).sort().reverse()
    },
    brief_ensure_snapshot: function (args) {
      var date = args && args.date
      if (date !== TODAY) return BRIEFS[date] || null
      if (BRIEFS[date]) return BRIEFS[date]

      var topLevelOpen = TASKS.filter(function (t) { return !t.parent_id && !t.completed })
      var dueToday = topLevelOpen.filter(function (t) { return t.due_date === TODAY }).map(briefTaskRef)
      var stillOpen = topLevelOpen
        .filter(function (t) { return t.due_date && t.due_date < TODAY })
        .sort(function (a, b) { return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0 })

      var brief = {
        date: date,
        version: 1,
        status: 'ready',
        source: 'nimble',
        layout: ['schedule', 'priorities', 'due_today', 'still_open', 'vault'],
        snapshot: {
          schedule: { events: CALENDAR_EVENTS.slice(), tomorrow: [] },
          priorities: DAILY_STATE.priorities,
          due_today: dueToday,
          still_open: { total: stillOpen.length, oldest: stillOpen.slice(0, 5).map(briefTaskRef) },
        },
        snapshot_schema: 1,
        generated_at: iso(TODAY, '07:00:00').replace('T', ' '),
        updated_at: iso(TODAY, '07:00:00').replace('T', ' '),
      }
      BRIEFS[date] = brief
      return brief
    },
    break_down_task: function () {
      return [
        'Pick the three strongest frames from the set',
        'Rough color pass in Lightroom',
        'Final crop + export at delivery specs',
        'Write the two-line context blurb',
      ]
    },

    // Projects
    get_projects: function () { return PROJECTS },
    create_project: function (args) {
      return project({
        id: newId('proj'),
        name: args.name,
        color: args.color,
        position: PROJECTS.length,
        parent_id: (args && args.parentId) || null,
      })
    },
    update_project: function () { return null },
    delete_project: function () { return null },

    // Labels (R1)
    list_labels: function () { return LABELS },
    create_label: function (args) {
      var label = {
        id: newId('label'),
        name: (args && args.name) || 'new label',
        color: (args && args.color) || 'gray',
        position: LABELS.length,
        created_at: iso(TODAY, '11:20:00'),
      }
      LABELS.push(label)
      return label
    },
    update_label: function (args) {
      var l = LABELS.find(function (x) { return x.id === (args && args.id) }) || LABELS[0]
      if (args) {
        if (args.name !== undefined && args.name !== null) l.name = args.name
        if (args.color !== undefined && args.color !== null) l.color = args.color
      }
      return Object.assign({}, l)
    },
    delete_label: function () { return null },
    set_task_labels: function (args) {
      var t = findTask(args && args.taskId) || TASKS[0]
      t.labels = (args && args.labelIds) || []
      t.updated_at = iso(TODAY, '11:25:00')
      return Object.assign({}, t)
    },

    // Sections (R1)
    list_sections: function (args) {
      return SECTIONS.filter(function (s) { return s.project_id === (args && args.projectId) })
    },
    create_section: function (args) {
      var section = {
        id: newId('sec'),
        project_id: (args && args.projectId) || 'proj-taskapp',
        name: (args && args.name) || 'New section',
        position: SECTIONS.length,
        external_id: null,
        external_source: null,
        created_at: iso(TODAY, '11:30:00'),
      }
      SECTIONS.push(section)
      return section
    },
    rename_section: function (args) {
      var s = SECTIONS.find(function (x) { return x.id === (args && args.id) }) || SECTIONS[0]
      if (args && args.name) s.name = args.name
      return Object.assign({}, s)
    },
    delete_section: function () { return null },
    reorder_sections: function () { return null },

    // Local tasks
    get_local_tasks: function (args) {
      var out = TASKS.slice()
      if (args) {
        if (args.projectId) out = out.filter(function (t) { return t.project_id === args.projectId })
        // Matches Rust/web: "due on or before" (still-open tasks included).
        if (args.dueDate) out = out.filter(function (t) { return t.due_date && t.due_date <= args.dueDate })
        if (!args.includeCompleted) out = out.filter(function (t) { return !t.completed })
      } else {
        out = out.filter(function (t) { return !t.completed })
      }
      return out
    },
    // create/update/delete below mutate TASKS in place — a prior version
    // returned a merged/new object without ever writing it back into TASKS,
    // so every mutation "succeeded" (resolved with the right-looking object)
    // but silently reverted on the next get_local_tasks() refetch. Found
    // while verifying Task 9's description-edit round trip: save, reopen,
    // and the reopened value was still the pre-edit one. Fixed for every
    // task-mutation command here, not just update, since they all shared
    // the same bug and every future task's harness verification depends on
    // mutations actually persisting for the session.
    create_local_task: function (args) {
      var t = task({
        id: newId('task'),
        content: (args && args.content) || 'New task',
        description: (args && args.description) || null,
        project_id: (args && args.projectId) || 'inbox',
        parent_id: (args && args.parentId) || null,
        priority: (args && args.priority) || 1,
        due_date: (args && args.dueDate) || null,
        due_time: (args && args.dueTime) || null,
        duration_minutes: (args && args.durationMinutes) || null,
        recurrence_rule: (args && args.recurrenceRule) || null,
        section_id: (args && args.sectionId) || null,
        labels: (args && args.labelIds) || [],
        position: TASKS.length,
        created_at: iso(TODAY, '09:30:00'),
        updated_at: iso(TODAY, '09:30:00'),
      })
      TASKS.push(t)
      return t
    },
    update_local_task: function (args) {
      var t = findTask(args && args.id) || TASKS[0]
      // Ordering mirrors nimble-core/src/db/tasks.rs update_local_task
      // exactly: all "set" updates apply first, then "clear" updates —
      // and clearDueTime nulls BOTH due_time and duration_minutes, AFTER
      // the duration_minutes set above it has already run. Get this order
      // wrong (e.g. clearDueTime before the durationMinutes set) and the
      // mock silently diverges from prod: setting Duration on a task with
      // no due time would apply, then get wiped, instead of surfacing the
      // real bug the harness is meant to catch.
      if (args) {
        if (args.content !== undefined && args.content !== null) t.content = args.content
        if (args.description !== undefined) t.description = args.description
        if (args.projectId) t.project_id = args.projectId
        if (args.priority !== undefined && args.priority !== null) t.priority = args.priority
        if (args.dueDate) t.due_date = args.dueDate
        if (args.clearDueDate) t.due_date = null
        if (args.linkedDocId !== undefined) t.linked_doc_id = args.linkedDocId
        if (args.dueTime) t.due_time = args.dueTime
        if (args.durationMinutes !== undefined && args.durationMinutes !== null) t.duration_minutes = args.durationMinutes
        if (args.recurrenceRule) t.recurrence_rule = args.recurrenceRule
        if (args.sectionId) t.section_id = args.sectionId
        if (args.clearDueTime) { t.due_time = null; t.duration_minutes = null }
        if (args.clearRecurrence) t.recurrence_rule = null
        if (args.clearSection) t.section_id = null
        if (args.clearDuration) t.duration_minutes = null
        if (args.labelIds !== undefined && args.labelIds !== null) t.labels = args.labelIds
      }
      t.updated_at = iso(TODAY, '10:00:00')
      return Object.assign({}, t)
    },
    update_task_status: function (args) {
      var t = findTask(args && args.id)
      if (t && args && args.status) {
        t.status = args.status
        t.completed = args.status === 'complete'
        t.completed_at = t.completed ? iso(TODAY, '10:05:00') : null
        t.updated_at = iso(TODAY, '10:05:00')
      }
      return null
    },
    complete_local_task: function (args) {
      var t = findTask(args && args.id)
      if (t) {
        t.completed = true
        t.status = 'complete'
        t.completed_at = iso(TODAY, '10:05:00')
        t.updated_at = iso(TODAY, '10:05:00')
      }
      return null
    },
    uncomplete_local_task: function (args) {
      var t = findTask(args && args.id)
      if (t) {
        t.completed = false
        t.status = 'todo'
        t.completed_at = null
        t.updated_at = iso(TODAY, '10:05:00')
      }
      return null
    },
    delete_local_task: function (args) {
      var id = args && args.id
      for (var i = TASKS.length - 1; i >= 0; i--) {
        if (TASKS[i].id === id || TASKS[i].parent_id === id) TASKS.splice(i, 1)
      }
      return null
    },
    reorder_local_tasks: function (args) {
      var ids = (args && args.taskIds) || []
      ids.forEach(function (id, i) {
        var t = findTask(id)
        if (t) t.position = i
      })
      return null
    },

    // Misc
    open_url: function () { return null },
    check_for_updates: function () {
      return { current_version: '1.4.2', latest_version: '1.4.2', update_available: false, release_url: null, error: null }
    },
    save_progress: function () {
      return { snapshot_id: 42, session_log_path: '/Users/marcosevilla/Obsidian/marcowits/sessions/2026-08-01.md' }
    },

    // Activity
    log_activity: function () { return null },
    get_activity_log: function () { return ACTIVITY_LOG },
    get_activity_summary: function () { return ACTIVITY_SUMMARY },

    // Captures
    get_captures: function (args) {
      var out = CAPTURES.slice()
      if (!args || !args.includeConverted) {
        out = out.filter(function (c) { return !c.converted_to_task_id })
      }
      if (args && args.limit) out = out.slice(0, args.limit)
      return out
    },
    create_capture: function (args) {
      return {
        id: newId('cap'),
        content: (args && args.content) || '',
        source: (args && args.source) || 'quick',
        converted_to_task_id: null,
        routed_to: null,
        context: null,
        created_at: iso(TODAY, '09:45:00'),
      }
    },
    convert_capture_to_task: function (args) {
      var cap = CAPTURES.find(function (c) { return c.id === (args && args.captureId) })
      var t = task({
        id: newId('task'),
        content: cap ? cap.content : 'Converted capture',
        project_id: (args && args.projectId) || 'inbox',
        position: TASKS.length,
        created_at: iso(TODAY, '09:50:00'),
        updated_at: iso(TODAY, '09:50:00'),
      })
      // Must land in TASKS (same reasoning as route_capture above) — Task 5's
      // convertWithDate follows this with an update_local_task keyed on the
      // returned id, which otherwise falls through findTask's TASKS[0] fallback.
      TASKS.push(t)
      // Mirrors Rust's mark_capture_converted (nimble-core convert flow).
      if (cap) cap.converted_to_task_id = t.id
      return t
    },
    delete_capture: function () { return null },
    import_obsidian_captures: function () { return 0 },

    // Capture routes
    get_capture_routes: function () { return CAPTURE_ROUTES },
    create_capture_route: function (args) {
      return {
        id: newId('route'),
        prefix: args.prefix,
        target_type: args.targetType || 'task',
        doc_id: args.docId || null,
        label: args.label,
        color: args.color,
        icon: args.icon,
        position: CAPTURE_ROUTES.length,
        created_at: iso(TODAY),
      }
    },
    update_capture_route: function () { return null },
    delete_capture_route: function () { return null },
    route_capture: function (args) {
      var route = CAPTURE_ROUTES.find(function (r) { return r.prefix === (args && args.prefix) }) || CAPTURE_ROUTES[0]
      if (route.target_type === 'task') {
        // Rust creates a real task and returns its id (capture_routes.rs), so a
        // follow-up update_local_task lands on it instead of TASKS[0]. Named
        // `created`, not `task` — the latter shadows the file-level `task()`
        // record-builder helper used throughout this file.
        var created = commands.create_local_task({ content: args.content })
        return { routed_to: created.id, target_type: 'task', created_id: created.id, label: route.label }
      }
      return {
        routed_to: route.doc_id || 'doc-ideas',
        target_type: route.target_type,
        created_id: newId('note'),
        label: route.label,
      }
    },

    // Docs
    get_doc_folders: function () { return DOC_FOLDERS },
    create_doc_folder: function (args) {
      return { id: newId('folder'), name: args.name, position: DOC_FOLDERS.length, created_at: iso(TODAY) }
    },
    rename_doc_folder: function () { return null },
    delete_doc_folder: function () { return null },
    get_documents: function (args) {
      if (args && args.folderId) {
        return DOCUMENTS.filter(function (d) { return d.folder_id === args.folderId })
      }
      return DOCUMENTS
    },
    get_document: function (args) {
      return DOCUMENTS.find(function (d) { return d.id === (args && args.id) }) || null
    },
    create_document: function (args) {
      return {
        id: newId('doc'),
        title: (args && args.title) || 'Untitled',
        content: '',
        folder_id: (args && args.folderId) || null,
        position: DOCUMENTS.length,
        created_at: iso(TODAY, '10:05:00'),
        updated_at: iso(TODAY, '10:05:00'),
      }
    },
    update_document: function (args) {
      var d = DOCUMENTS.find(function (x) { return x.id === (args && args.id) }) || DOCUMENTS[0]
      return Object.assign({}, d, {
        title: args && args.title !== undefined && args.title !== null ? args.title : d.title,
        content: args && args.content !== undefined && args.content !== null ? args.content : d.content,
        folder_id: args && args.folderId !== undefined ? args.folderId : d.folder_id,
        updated_at: iso(TODAY, '10:10:00'),
      })
    },
    delete_document: function () { return null },
    search_documents: function (args) {
      var q = ((args && args.query) || '').toLowerCase()
      return DOCUMENTS.filter(function (d) {
        return d.title.toLowerCase().indexOf(q) !== -1 || d.content.toLowerCase().indexOf(q) !== -1
      })
    },
    get_doc_notes: function (args) {
      return DOC_NOTES[(args && args.docId) || ''] || []
    },
    create_doc_note: function (args) {
      return {
        id: newId('note'),
        doc_id: (args && args.docId) || 'doc-ideas',
        content: (args && args.content) || '',
        position: 99,
        created_at: iso(TODAY, '10:15:00'),
      }
    },
    delete_doc_note: function () { return null },
    reorder_doc_notes: function () { return null },

    // Focus (durable engine): an empty, read-only queue in the harness.
    focus_capabilities: function () {
      return { queue_read: true, queue_write: false, history_read: true, live_timing: false,
        companion: false, import: false, reason: 'Focus is read-only in the browser harness.' }
    },
    focus_snapshot: function () {
      return { queue_revision: 0, engine_revision: 0, owner_epoch: 'mock', process_generation: 1,
        writer_device_id: 'mock', queue: [], selected_occurrence_id: null, session: null, totals: {},
        as_of: new Date().toISOString(), checkpoint_at: null, recovery_reason: null, replica: false }
    },
    focus_history: function () { return { rows: [], next_cursor: null } },

    // Goals
    get_goals: function () { return GOALS },
    get_goal: function (args) {
      return GOALS.find(function (g) { return g.id === (args && args.id) }) || GOALS[0]
    },
    create_goal: function (args) {
      return {
        id: newId('goal'),
        name: (args && args.name) || 'New goal',
        description: (args && args.description) || null,
        status: (args && args.status) || 'active',
        life_area_id: (args && args.lifeAreaId) || null,
        start_date: (args && args.startDate) || null,
        target_date: (args && args.targetDate) || null,
        color: (args && args.color) || null,
        position: GOALS.length,
        created_at: iso(TODAY),
        updated_at: iso(TODAY),
      }
    },
    update_goal: function (args) {
      var g = GOALS.find(function (x) { return x.id === (args && args.id) }) || GOALS[0]
      return Object.assign({}, g, { updated_at: iso(TODAY) })
    },
    delete_goal: function () { return null },

    // Milestones
    get_milestones: function (args) {
      return MILESTONES[(args && args.goalId) || ''] || []
    },
    create_milestone: function (args) {
      return {
        id: newId('ms'),
        goal_id: (args && args.goalId) || 'goal-01',
        name: (args && args.name) || 'New milestone',
        target_date: (args && args.targetDate) || null,
        completed: false,
        completed_at: null,
        position: 99,
        created_at: iso(TODAY),
      }
    },
    update_milestone: function (args) {
      var list = []
      Object.keys(MILESTONES).forEach(function (k) { list = list.concat(MILESTONES[k]) })
      var m = list.find(function (x) { return x.id === (args && args.id) }) || list[0]
      return Object.assign({}, m, {
        completed: args && args.completed !== undefined && args.completed !== null ? args.completed : m.completed,
        completed_at: args && args.completed ? iso(TODAY, '11:00:00') : m.completed_at,
      })
    },
    delete_milestone: function () { return null },

    // Life areas
    get_life_areas: function () { return LIFE_AREAS },
    create_life_area: function (args) {
      return { id: newId('la'), name: args.name, color: args.color, icon: args.icon, position: LIFE_AREAS.length, created_at: iso(TODAY) }
    },
    update_life_area: function (args) {
      var la = LIFE_AREAS.find(function (x) { return x.id === (args && args.id) }) || LIFE_AREAS[0]
      return Object.assign({}, la)
    },
    delete_life_area: function () { return null },

    // Habits
    get_habits: function () { return habitsWithStats() },
    create_habit: function (args) {
      return {
        id: newId('habit'),
        name: (args && args.name) || 'New habit',
        category: (args && args.category) || null,
        icon: (args && args.icon) || 'circle',
        color: (args && args.color) || '#5e6ad2',
        active: true,
        position: HABITS.length,
        created_at: iso(TODAY),
      }
    },
    update_habit: function (args) {
      var h = HABITS.find(function (x) { return x.id === (args && args.id) }) || HABITS[0]
      return {
        id: h.id, name: h.name, category: h.category, icon: h.icon, color: h.color,
        active: args && args.active !== undefined && args.active !== null ? args.active : h.active,
        position: h.position, created_at: h.created_at,
      }
    },
    delete_habit: function () { return null },
    log_habit: function (args) {
      return {
        id: newId('hlog'),
        habit_id: (args && args.habitId) || 'habit-gym',
        date: (args && args.date) || TODAY,
        intensity: (args && args.intensity) || 3,
        created_at: iso(TODAY, '21:00:00'),
      }
    },
    unlog_habit: function () { return null },
    get_habit_logs: function (args) {
      return buildHabitLogs(args && args.habitId, args && args.days)
    },
    get_habit_heatmap: function (args) {
      return buildHeatmap(args && args.habitId, args && args.days)
    },
    import_goals_from_vault: function () {
      return { goals_created: 0, habits_created: 0 }
    },

    // Sync
    sync_push: function () { return 0 },
    sync_pull: function () { return 0 },
    sync_get_status: function () {
      return {
        pending_changes: 0,
        last_sync: iso(TODAY, '08:12:00'),
        device_id: 'macbook-pro-m3',
        turso_configured: true,
        remote_initialized: true,
      }
    },
    sync_configure: function () { return null },
    sync_test_connection: function () { return null },
    sync_initialize_remote: function () { return null },
    sync_seed_existing: function () { return 0 },

    // Todoist two-way sync (R1-era)
    get_todoist_sync_status: function () {
      return {
        enabled: true,
        connected: true,
        last_sync_at: iso(TODAY, '08:05:00'),
        last_error: null,
        pending_ops: 0,
        error_ops: 0,
        errors: [],
      }
    },
    todoist_sync_now: function () {
      return { skipped: null, pushed: 0, created: 0, updated: 0, deleted: 0, projects_upserted: 0 }
    },
    set_todoist_sync_enabled: function () { return null },

    // Demo mode
    demo_status: function () { return false },
    demo_toggle: function () { return null },

    // ── Capture strip (C-track) ────────────────────────────────────────────
    dismiss_capture_strip: function () { return null },

    // ── Reminders (C2, macOS notifications) ────────────────────────────────
    reminder_get_status: function () { return REMINDER_STATUS },
    reminder_request_permission: function () { return REMINDER_STATUS },
    reminder_list_catch_up: function () {
      return REMINDER_CATCH_UP.filter(function (i) { return !ACKNOWLEDGED[i.occurrenceKey] })
    },
    reminder_acknowledge: function (args) {
      if (args && args.occurrenceKey) ACKNOWLEDGED[args.occurrenceKey] = true
      return null
    },

    // ── Google Calendar (C2, OAuth) — fresh install: not configured ────────
    google_calendar_status: function () { return GOOGLE_STATUS },
    google_calendar_configure: function () {
      return Object.assign({}, GOOGLE_STATUS, { clientSecretConfigured: true })
    },
    google_calendar_connect: function () {
      return Object.assign({}, GOOGLE_STATUS, {
        connected: true,
        clientSecretConfigured: true,
        calendarLabel: 'marco@gmail.com',
      })
    },
    google_calendar_disconnect: function () { return GOOGLE_STATUS },
    google_calendar_sync_now: function () { return { changedTaskIds: [], errorCode: null } },
    google_calendar_list_conflicts: function () { return [] },
    google_calendar_resolve_conflict: function () { return null },

    // ── Markdown migrations (Settings → Data) ──────────────────────────────
    preview_tasks_markdown_migration: function () {
      return { total: 14, convertible: 3, already_plain: 11, flagged: [] }
    },
    migrate_tasks_to_markdown: function () {
      return {
        converted: 3,
        skipped_plain: 11,
        backup_path: '/Users/marcosevilla/Library/Application Support/nimble/backups/tasks-pre-md-' + TODAY + '.json',
      }
    },
    preview_docs_markdown_migration: function () {
      return { total: 6, convertible: 2, already_plain: 4, flagged: [] }
    },
    migrate_docs_to_markdown: function () {
      return {
        converted: 2,
        skipped_plain: 4,
        backup_path: '/Users/marcosevilla/Library/Application Support/nimble/backups/docs-pre-md-' + TODAY + '.json',
      }
    },

    // ── Obsidian vault library (plan 2; read-only in the UI) ──────────────
    vault_status: function () {
      return {
        configured: true,
        root: SETTINGS.obsidian_vault_path,
        note_count: 1104,
        last_scan_at: iso(TODAY, '08:04:12'),
        last_error: null,
        excludes: ['.obsidian', '.trash', 'templates'],
      }
    },
    vault_rescan: function () {
      return { scanned: 1104, indexed: 3, unchanged: 1101, removed: 0, skipped: 2, walk_errors: 0 }
    },
    vault_list_notes: function () { return VAULT_NOTES.map(vaultSummary) },
    vault_get_note: function (args) {
      var n = findVaultNote(args && args.path)
      return n ? vaultDetail(n) : null
    },
    vault_search: function (args) {
      var q = String((args && args.query) || '').trim().toLowerCase()
      var limit = (args && args.limit) || 20
      if (!q) return []
      return VAULT_NOTES.filter(function (n) {
        return (
          n.title.toLowerCase().indexOf(q) >= 0 ||
          n.path.toLowerCase().indexOf(q) >= 0 ||
          n.content.toLowerCase().indexOf(q) >= 0
        )
      })
        .slice(0, limit)
        .map(function (n) {
          var body = n.content.replace(/^---[\s\S]*?---\n/, '')
          var idx = body.toLowerCase().indexOf(q)
          var start = Math.max(0, idx - 40)
          var snippet = (start > 0 ? '…' : '') + body.slice(start, start + 120).replace(/\n+/g, ' ') + '…'
          return { id: n.id, path: n.path, title: n.title, snippet: snippet }
        })
    },
    vault_backlinks: function (args) {
      var target = findVaultNote(args && args.path)
      if (!target) return []
      var stem = target.title.toLowerCase()
      var hits = VAULT_NOTES.filter(function (n) {
        return n.id !== target.id && n.content.toLowerCase().indexOf('[[' + stem) >= 0
      })
      // Every note gets at least two backlinks so the panel never looks empty.
      if (hits.length < 2) {
        hits = hits.concat(
          VAULT_NOTES.filter(function (n) { return n.id !== target.id && hits.indexOf(n) < 0 }).slice(0, 2 - hits.length),
        )
      }
      return hits.map(vaultSummary)
    },
    vault_resolve_link: function (args) {
      var to = String((args && args.toPath) || '').replace(/\.md$/, '').toLowerCase()
      var n = VAULT_NOTES.filter(function (x) {
        return x.title.toLowerCase() === to || x.path.replace(/\.md$/, '').toLowerCase() === to
      })[0]
      return n ? vaultSummary(n) : null
    },
    vault_save_note: function (args) {
      var n = findVaultNote(args && args.path)
      if (n && args.content != null) {
        n.content = args.content
        n.updated_at = iso(TODAY, '09:41:00')
      }
      return { kind: 'written', hash: 'sha256:' + hash01(String((args && args.content) || '')).toFixed(3).slice(2) + 'a1b2c3' }
    },
    vault_create_note: function (args) {
      var path = (args && args.path) || 'inbox/Untitled.md'
      var n = {
        id: newId('vault'),
        path: path,
        title: path.split('/').pop().replace(/\.md$/, ''),
        frontmatter: { created: TODAY },
        content: (args && args.content) || '# ' + path.split('/').pop().replace(/\.md$/, '') + '\n\n',
        updated_at: iso(TODAY, '09:42:00'),
      }
      VAULT_NOTES.unshift(n)
      return vaultDetail(n)
    },
    vault_open_in_obsidian: function () { return null },
  }

  // ── Tauri internals ──────────────────────────────────────────────────────

  var callbacks = {}
  var callbackId = 0
  var eventListenerId = 0

  function transformCallback(callback, once) {
    callbackId += 1
    var id = callbackId
    callbacks[id] = function (payload) {
      if (once) delete callbacks[id]
      if (callback) callback(payload)
    }
    // Real Tauri registers window[`_${id}`]; some plugin code invokes it directly.
    Object.defineProperty(window, '_' + id, {
      value: callbacks[id],
      writable: false,
      configurable: true,
    })
    return id
  }

  function mockInvoke(cmd, args) {
    // Built-in event plugin: listen() expects a numeric event id back.
    if (cmd === 'plugin:event|listen') {
      eventListenerId += 1
      return Promise.resolve(eventListenerId)
    }
    if (
      cmd === 'plugin:event|unlisten' ||
      cmd === 'plugin:event|emit' ||
      cmd === 'plugin:event|emit_to'
    ) {
      return Promise.resolve(null)
    }
    // Any other plugin command (window, window-state, fs, shell, sql, app…):
    // resolve null so hide()/show()/restoreState() etc. never throw.
    if (cmd.indexOf('plugin:') === 0) {
      console.debug('[mock-tauri] plugin command stubbed:', cmd)
      return Promise.resolve(null)
    }
    var handler = commands[cmd]
    if (handler) {
      try {
        return Promise.resolve(handler(args || {}))
      } catch (e) {
        console.debug('[mock-tauri] handler error for', cmd, e)
        return Promise.resolve(null)
      }
    }
    console.warn('[mock-tauri] unhandled command', cmd, args)
    return Promise.resolve(null)
  }

  window.__TAURI_INTERNALS__ = {
    invoke: mockInvoke,
    transformCallback: transformCallback,
    unregisterCallback: function (id) {
      delete callbacks[id]
      try { delete window['_' + id] } catch (e) { /* noop */ }
    },
    runCallback: function (id, payload) {
      if (callbacks[id]) callbacks[id](payload)
    },
    convertFileSrc: function (filePath) {
      return filePath
    },
    // getCurrentWindow()/getCurrentWebview() read metadata synchronously.
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' },
    },
    plugins: {},
  }

  // event.js _unlisten() calls this synchronously before invoking the plugin.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function () { /* noop */ },
  }

  // core.isTauri() checks this flag.
  window.isTauri = true

  console.debug('[mock-tauri] Tauri backend polyfill installed (' + Object.keys(commands).length + ' commands)')
})()

// ── Deep-link shim: ?page=X selects the page via the DEV __stores hatch ──
// The store isn't loaded yet when this init script runs, so poll for it.
// `?page=activity` (or the retired `?page=session`) opens Settings → Activity
// through the app's own `navigateTo`; `&settings=<sub-page id>` picks any
// other Settings sub-page.
;(function () {
  var params = new URLSearchParams(window.location.search)
  var page = params.get('page')
  var settingsPage = params.get('settings')
  var tries = 0
  var timer = setInterval(function () {
    tries++
    var stores = window.__stores
    if (stores && stores.useAppStore) {
      clearInterval(timer)
      stores.useAppStore.setState({ setupComplete: true })
      if (page && !(stores.navigateTo && stores.navigateTo(page))) {
        stores.useAppStore.setState({ currentPage: page })
      }
      if (settingsPage && stores.useSettingsNavStore) {
        stores.useSettingsNavStore.getState().showPage(settingsPage)
      }
      console.debug('[mock-tauri] deep-link applied:', page || '(default)')
    } else if (tries > 100) {
      clearInterval(timer)
      console.debug('[mock-tauri] __stores hatch never appeared')
    }
  }, 50)
})()
