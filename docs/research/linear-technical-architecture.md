# How Linear Is Built: Technical Architecture Research

> Research compiled 2026-03-22. Sources include Linear's engineering blog, Pragmatic Engineer's CTO interview, reverse-engineering projects endorsed by Linear's CTO, and founder talks.

---

## 1. Tech Stack

### Frontend
- **React** with **TypeScript** -- the entire codebase is TypeScript, enabling code sharing between frontend and backend
- **MobX** for reactive state management -- models are MobX observables that automatically propagate changes to UI components without explicit update triggers
- **GraphQL** for API mutations (but NOT for reads -- reads come from the local sync engine)
- **IndexedDB** as the client-side database (via the sync engine)

### Backend
- **Node.js** with **TypeScript** (same language as frontend, deliberate choice for hiring flexibility and code sharing)
- **PostgreSQL** as the primary database
- **Redis** for queuing operations
- **MongoDB** for caching scenarios
- **GraphQL** API layer
- **WebSockets** for real-time delta sync

### Infrastructure
- **Google Cloud Platform (GCP)** -- chose over AWS for better cost-for-performance and UI
- **Kubernetes** -- adopted deliberately early (when they had only 2 engineers), reasoning that migration later would be more painful
- Remote-first, teams organized by timezone

### Desktop App
- **Electron** -- wraps the same React/TypeScript web application
- Provides native features: notifications, dock badges, always-on behavior
- Navigation system designed to work both as Electron app (macOS/Windows) and in any browser

### Mobile App
- **Native Swift** (iOS) and **Kotlin** (Android) -- NOT React Native
- Built natively for performance and fluid UX
- Launched in 2024

### Rich Text Editor
- Uses **CRDTs** specifically for issue descriptions (collaborative rich text editing)
- Most likely ProseMirror-based (consistent with the ecosystem and CRDT integration pattern)
- CRDTs were added relatively recently -- they didn't use them initially

> "A pretty basic stack. React, MobX, Typescript and Node with PostgreSQL. And some home-made sync magic." -- Tuomas Artman, CTO

---

## 2. Architecture Patterns

### Local-First / Sync Engine Architecture
Linear's core architectural innovation is their custom **sync engine** (often called LSE -- Linear Sync Engine). This is not a traditional client-server CRUD app. The fundamental principle: **the client has a full copy of the data, and the UI reads from local state, never from the network.**

Key properties:
- **All data lives on the client** -- issues, projects, teams, users, labels, etc. are loaded into memory and IndexedDB
- **UI reads are instant** -- searching/filtering issues is just filtering a JavaScript array in memory (0ms latency)
- **Writes are optimistic** -- changes apply to local state immediately, then sync to server in background
- **Network is not required** -- the app functions fully offline; queued transactions replay when reconnected

### How It Differs From Traditional Apps
Traditional app: User action -> API request -> wait for response -> update UI
Linear: User action -> update local state (instant) -> UI re-renders -> sync to server in background

---

## 3. Data Sync: The Linear Sync Engine (Deep Dive)

### Bootstrap Process (First Load)
1. **Full bootstrap**: `GET /sync/bootstrap?type=full` returns ~40 model types (Issues, Projects, Teams, Users, etc.) as `text/plain` with lines like `"ModelName=<JSON>"`
2. **Partial bootstrap**: A second request with `type=partial` defers less critical models (Comments, IssueHistory) to optimize initial page load
3. Each bootstrap response includes `_metadata_` with a `lastSyncId` value (monotonically increasing sequence number)
4. Data persists to IndexedDB, then critical models hydrate into memory as MobX observables
5. WebSocket connection opens

### Initialization Sequence (7 Steps)
1. `StoreManager` instantiates stores for each model type + `SyncActionStore`
2. `Database` initializes IndexedDB, creates tables, runs migrations if schema hash changed
3. System determines bootstrap type (full vs incremental)
4. Retrieves model data from server
5. Persists to IndexedDB
6. Critical models hydrate into memory with MobX observability
7. WebSocket connection opens for delta packets

### Delta Updates (Real-Time Sync)
- Server pushes `"cmd": "sync"` messages via WebSocket containing arrays of **SyncActions**
- Each SyncAction has: `id` (integer), `action` ("I"=Insert, "U"=Update, "D"=Delete, "A"=Archive), `modelName`, `modelId`, `data` (changed fields or null)
- Delta packets contain monotonically increasing `sync id` values
- GraphQL mutations return only `lastSyncId` as response (minimal payload -- actual data arrives via WebSocket)

### Delta Catch-Up
- If client falls behind (e.g., was offline), `GET /sync/delta?lastSyncId=X&toSyncId=Y` returns only the missed SyncActions
- Client replays changes sequentially to restore consistency

### Transaction System
- All model operations (create, update, delete, archive) are wrapped in **transactions**
- On property change: immediate in-memory update + record previous value (for undo)
- `save()` generates an `UpdateTransaction`, queued for batching
- Transactions persist to IndexedDB's `__transactions` table (survives crashes/offline)
- `TransactionQueue` batches and sends to server
- Success: remove cached transaction. Failure: **client-side reversal** (rollback)
- Built-in undo/redo support via stored previous values

### Conflict Resolution
- **Last-Writer-Wins (LWW)** for most data -- server establishes total ordering via sync IDs
- **CRDTs** only for issue descriptions (rich text collaborative editing)
- Server is the source of truth for ordering -- closer to Operational Transformation philosophy than full CRDT
- Conflicts are rare in practice because most Linear operations are non-overlapping

### Model System
- Models (Issue, Team, Comment, etc.) have decorators that populate a `ModelRegistry`
- Load strategies: `instant`, `lazy`, `partial`, `explicitlyRequested`, `local`
- Property types: regular, ephemeral, references, referenceModels, referenceCollections, backReferences, referenceArrays
- Access control via **SyncGroups** (UUIDs representing user identity, team memberships, roles)

### Offline Resilience
- If WebSocket connection drops, transactions cache in IndexedDB
- On reconnection, cached transactions automatically resend
- Delta catch-up fills any gaps in sync state

---

## 4. UI/UX Patterns That Make It Feel Fast

### Optimistic Updates
- Every user action applies instantly to local state
- No loading spinners for CRUD operations
- If server rejects a change, the client rolls back (rare in practice)

### Keyboard-First Design
- **Single-key shortcuts**: `c` (create issue), `a` (assign), `l` (label), `p` (priority), `f` (filter)
- **Cmd+K command palette**: global access to every action -- create, search, filter, assign, navigate
- `/` for instant view filtering
- `E` for quick assign/move
- Designed so power users never need to touch the mouse

### Command Palette (Cmd+K)
- Fuzzy search across all entities and actions
- Keyboard navigation through results
- Context-aware (shows relevant actions based on current view)
- Essentially replaces traditional menus

### UI Animation and Polish
- Minimal, purposeful transitions (not decorative)
- Hardware-accelerated CSS transforms and opacity changes for 60fps
- View transitions feel instant because data is already in memory
- No skeleton screens needed -- data is local

### Design Philosophy (Karri Saarinen, CEO)
- Design is a reference, never a deliverable -- the real design IS the app
- Minimal design system: mostly colors, type, and basic components
- Screenshot the app and design on top of existing UI
- Ship and iterate, don't over-specify in Figma

---

## 5. Performance Tricks

### Why It Feels 3.7x Faster Than Jira

1. **Zero network latency for reads**: All data is in-memory JavaScript objects. Searching 10,000 issues = filtering an array (microseconds, not milliseconds)

2. **Pre-warmed startup**: User data loads from IndexedDB on app open, so the app renders immediately with real data (no loading states)

3. **Partial bootstrap**: Defers non-critical models to second request, so the initial render happens faster

4. **Minimal API payloads**: GraphQL mutations return only `lastSyncId`, not full objects. Actual data arrives via efficient WebSocket deltas

5. **Batched transactions**: Multiple rapid changes batch into single server requests instead of individual API calls

6. **MobX reactive rendering**: Only components observing changed properties re-render -- no unnecessary React reconciliation

7. **Background sync**: Network operations never block the UI thread

8. **Model load strategies**: Not everything loads at once -- `lazy`, `partial`, and `explicitlyRequested` strategies control what enters memory and when

9. **Schema-aware IndexedDB**: Migration system means the local DB evolves with the app without requiring full re-bootstrap

10. **Efficient delta protocol**: SyncActions carry only changed fields, not full objects

### The Core Insight
Linear inverted the traditional web app architecture. Instead of "server has data, client requests it," they made the client THE database. The server is just a sync coordinator. This eliminates the fundamental bottleneck of web apps: network round-trips in the interaction path.

---

## 6. Key Sources

- [The Story of Linear (Pragmatic Engineer / Gergely Orosz)](https://newsletter.pragmaticengineer.com/p/linear) -- CTO interview covering tech stack, infrastructure decisions, engineering culture
- [Scaling the Linear Sync Engine (Linear Blog)](https://linear.app/now/scaling-the-linear-sync-engine) -- Official deep dive by Tuomas Artman
- [Reverse Engineering Linear's Sync Magic (Mark Not Found)](https://marknotfound.com/posts/reverse-engineering-linears-sync-magic/) -- Detailed technical analysis of the sync protocol
- [Reverse Linear Sync Engine (GitHub, endorsed by Linear CTO)](https://github.com/wzhudev/reverse-linear-sync-engine) -- Annotated code-level reverse engineering
- [Linear Sent Me Down a Local-First Rabbit Hole (Bytemash)](https://bytemash.net/posts/i-went-down-the-linear-rabbit-hole/) -- Analysis of local-first patterns
- [Linear's Sync Engine Architecture (Fujimon)](https://www.fujimon.com/blog/linear-sync-engine) -- Architecture overview
- [Linear Tech Stack (StackShare)](https://stackshare.io/linear/linear) -- Community-maintained stack listing
- [Tuomas Artman tweet on stack](https://x.com/artman/status/1119046856317652992) -- Original "pretty basic stack" quote
- [How We Redesigned the Linear UI (Linear Blog)](https://linear.app/now/how-we-redesigned-the-linear-ui) -- UI/design approach
- [Tuomas Artman on Designing Surprising Tools (Mercury Meridian)](https://meridian.mercury.com/tuomas-artman) -- Design philosophy interview

---

## 7. Relevance to Personal Triage App

Key patterns worth considering for a personal triage/briefing app:

1. **Local-first with sync**: Even for a personal tool, storing data in IndexedDB and syncing in background eliminates perceived latency
2. **Optimistic updates**: Apply changes immediately, reconcile later
3. **Keyboard-first interaction**: Single-key shortcuts + command palette for power users with ADHD (reduce friction)
4. **Electron for desktop**: Linear proves you can make Electron feel fast if the underlying architecture is right (the bottleneck is usually network, not Electron)
5. **MobX for reactive state**: Surgical re-renders without the complexity of Redux
6. **Bootstrap + delta pattern**: Load everything on first open, then stream changes -- good for personal data sizes
