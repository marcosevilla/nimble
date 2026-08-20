This research is extensive. Here is the full synthesis across all four areas.

---

# Deep Research: Building a Personal Productivity Desktop App for macOS

## 1. Mac Desktop App Development Approaches

### Native SwiftUI

**What it is:** Apple's declarative UI framework, purpose-built for macOS (and iOS/iPadOS/watchOS/visionOS). You write Swift code, use Xcode, and get direct access to every Apple API.

**Pros:**
- Best possible native feel. Menus, notifications, Spotlight, file system, widgets, SharePlay -- everything "just works" because you're on Apple's platform.
- Smallest possible binary size and memory footprint. No runtime overhead from web engines.
- Apple continues to invest heavily. WWDC25 brought significant improvements to macOS list performance (snappy with 10,000+ items), new menu bar icon support, and better preview tooling in Xcode 16.
- Xcode 16 added ML-powered code completion that specifically understands SwiftUI patterns.
- SwiftUI's declarative syntax is relatively designer-friendly; it reads somewhat like describing a UI.

**Cons:**
- Requires learning Swift and the Apple development ecosystem from scratch. The realistic timeline for a non-developer to reach proficiency is 3-6 months of consistent practice ([source](https://brainstation.io/career-guides/is-ios-development-hard-to-learn)).
- macOS-only. No path to Windows or Linux without rewriting.
- SwiftUI for macOS is still catching up to SwiftUI for iOS. Some experienced developers note you "trade user experience for developer experience upfront," meaning SwiftUI sometimes lacks polish for desktop-specific patterns ([source](https://troz.net/post/2025/swiftui-mac-2025/)).
- Xcode is the only real IDE option, and it's heavy and opinionated.
- Claude Code can generate Swift/SwiftUI, but the training data for SwiftUI macOS patterns is thinner than for web technologies. Rust's compiler catches mistakes; Swift's does too, but the feedback loop through Xcode is slower than a terminal-based workflow.

**Performance:** Excellent. Native compilation, minimal memory, instant startup.

**Claude Code compatibility:** Moderate. Claude can write Swift, but web technologies (React, TypeScript) are where Claude has the deepest training data and produces the most reliable output. SwiftUI macOS specifically is a thinner slice of training data than React.

---

### Electron

**What it is:** The established approach for wrapping web apps (HTML/CSS/JS) into desktop applications by bundling a full Chromium browser and Node.js runtime. Powers VS Code, Slack, Discord, Notion, and Obsidian.

**Pros:**
- Mature ecosystem with massive community. Virtually any problem you encounter has been solved before.
- Full Node.js access for backend logic, file system operations, and native module integration.
- Your existing React/Next.js/Tailwind skills transfer directly.
- Extensive documentation and tutorials. Claude Code has deep training data here.
- Plugin architectures are well-understood (Obsidian's entire plugin system runs in Electron).

**Cons:**
- **Heavy.** Even a "Hello World" app is 100MB+ and idles at 200-300MB RAM ([source](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)). For a personal productivity tool that should feel light, this is a significant philosophical mismatch.
- Startup time of 1-2 seconds on mid-range hardware. For a tool you open dozens of times a day, this friction accumulates.
- Battery drain. Running a full browser engine is inherently power-hungry.
- Security requires discipline -- broad Node/OS API access is opt-out rather than opt-in.
- The source code in an Electron app is essentially readable JavaScript; no compilation step protects it.
- Developer sentiment has shifted. The XDA headline "I'm sick of every PC program turning into an Electron app" ([source](https://www.xda-developers.com/sick-every-pc-program-electron-app/)) reflects growing user frustration.

**Performance:** Poor relative to alternatives. 200-300MB idle memory, 1-2 second startup, 100MB+ install size.

**Claude Code compatibility:** Excellent. JavaScript/TypeScript is Claude's strongest language. React components, Node.js backend logic, and Electron-specific APIs are all well-covered in training data.

---

### Tauri (Recommended)

**What it is:** A Rust-powered framework that uses the system's native WebView (WebKit on macOS) instead of bundling Chromium. Your frontend is still HTML/CSS/JS (React, Vue, Svelte, etc.), but the backend is Rust. Tauri 2.0 shipped in late 2024 and adoption grew 35% year-over-year ([source](https://raftlabs.medium.com/tauri-vs-electron-a-practical-guide-to-picking-the-right-framework-5df80e360f26)).

**Pros:**
- **Dramatically lighter than Electron.** App installers under 10MB (vs 100MB+). Idle memory of 30-40MB (vs 200-300MB). Startup under 500ms (vs 1-2 seconds) ([source](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)).
- Your frontend is React + TypeScript + Tailwind -- your existing skills transfer directly.
- Rust's type system and memory safety act as an automatic code reviewer, catching errors that would slip through in JavaScript ([source](https://medium.com/@sam.van.overmeire/just-another-observation-on-using-claude-for-rust-coding-ca9942dd9f15)).
- Security-first by design. Permissions are opt-in, not opt-out.
- Full macOS native API access: notifications (with custom sounds), file system, menu bar/system tray, global shortcuts, system dialogs, and macOS-specific permissions ([source](https://v2.tauri.app/plugin/)).
- Cross-platform to Windows, Linux, and even mobile (iOS/Android) from the same codebase in Tauri 2.0.
- Rich plugin ecosystem: official plugins for SQLite, notifications, file system, dialogs, clipboard, global shortcuts, deep linking, auto-updates, and more.
- Production-ready starter templates exist with React 19 + TypeScript + Tailwind + shadcn/ui + Vite already wired up ([source](https://github.com/dannysmith/tauri-template)).
- Active community: 17,700+ Discord members, 87k+ GitHub stars.

**Cons:**
- You need *some* Rust for backend logic (file system operations, database queries, system integrations). However, for simple apps, you can get by with 4-5 hours of basic Rust tutorials ([source](https://github.com/tauri-apps/tauri/discussions/3343)). You can also use sidecars to run Python or Node.js scripts.
- The WebView on macOS (WebKit/Safari) has some rendering differences from Chromium. Occasionally a CSS feature that works in Chrome won't work identically in Safari's WebView.
- Smaller ecosystem than Electron -- fewer third-party libraries, fewer Stack Overflow answers.
- Rust compile times are slower than JavaScript build times (though HMR for the frontend is instant).
- Claude Code's Rust output needs more supervision than its TypeScript output. Rust's compiler catches many issues, but Claude makes enough mistakes that you need to check everything ([source](https://medium.com/@sam.van.overmeire/just-another-observation-on-using-claude-for-rust-coding-ca9942dd9f15)). However, Claude generates good Rust unit tests.

**Performance:** Excellent. 30-40MB idle, sub-500ms startup, under 10MB install.

**Claude Code compatibility:** Very good for the frontend (React/TypeScript). Moderate for the Rust backend, but improving -- and Rust's compiler serves as a safety net that catches Claude's mistakes.

---

### Flutter for Desktop

**What it is:** Google's cross-platform framework using Dart and the Impeller rendering engine. Desktop support reached macOS at 24.1% adoption ([source](https://kitrum.com/blog/why-flutter-isnt-ideal-for-cross-platform-development/)).

**Pros:**
- Single codebase for macOS, Windows, Linux, iOS, Android, and web.
- The Impeller graphics engine (replacing Skia) delivers smooth animations.
- Good native API interop via FFI.

**Cons:**
- Requires learning Dart, a language with a smaller community and fewer resources than JavaScript or Swift.
- Desktop support is less mature than mobile. Complex desktop UI patterns (multi-window, menu bars, keyboard navigation) feel second-class.
- Limited plugin ecosystem for desktop-specific features.
- Claude Code has relatively less training data on Dart/Flutter compared to React/TypeScript.
- Does not feel like a native macOS app. Custom rendering engine means it always looks slightly "off."

**Performance:** Good. Compiled to native code via Impeller. Better than Electron, roughly comparable to Tauri.

**Claude Code compatibility:** Low-moderate. Dart is less represented in Claude's training data than TypeScript or Rust.

---

### React Native for macOS

**What it is:** Microsoft maintains a fork of React Native that targets macOS and Windows. Your React knowledge transfers, and you write components that render to native macOS views.

**Pros:**
- Leverages existing React knowledge.
- Components render to actual native macOS views, not a web view.
- Microsoft's investment signals long-term support.

**Cons:**
- macOS support is still a secondary platform. The ecosystem and community are much smaller than React Native for mobile.
- Desktop-specific APIs (menu bar, system tray, global shortcuts) require bridging to native code.
- Fewer desktop-specific libraries and examples.
- The "learn once, write anywhere" promise works better for mobile than desktop.

**Performance:** Good. Native views, no web engine overhead.

**Claude Code compatibility:** Moderate. React patterns transfer, but macOS-specific bridging code is niche.

---

### Comparison Summary Table

| Criterion | SwiftUI | Electron | Tauri | Flutter | RN macOS |
|---|---|---|---|---|---|
| Memory (idle) | ~15-20MB | 200-300MB | 30-40MB | ~50-80MB | ~40-60MB |
| Startup time | <200ms | 1-2s | <500ms | <500ms | <500ms |
| Install size | <5MB | 100MB+ | <10MB | ~20-30MB | ~15-25MB |
| Learning curve (for Marco) | High | Low | Low-Medium | High | Medium |
| Native macOS feel | Best | Poor | Good | Poor | Good |
| Claude Code effectiveness | Moderate | Excellent | Very Good | Low-Moderate | Moderate |
| Cross-platform | No | Yes | Yes | Yes | Partial |
| Ecosystem maturity | High (Apple) | Highest | Growing fast | Medium | Low |

---

## 2. Best Practices for Personal Productivity Software

### Design Principles

**The "Tool Should Disappear" Principle**

The best productivity apps share a philosophy: the software should become invisible during use. As one analysis put it, "Speed isn't about raw performance -- it's about reducing the friction between intention and action" ([source](https://www.xda-developers.com/productivity-app-that-gets-out-of-the-way/)). Apps that stayed in users' rotation share these traits:
- Launch in under 3 seconds (ideally under 1 second)
- Keyboard shortcuts for everything -- mouse is optional
- No interruptions (notifications, prompts, or suggestions) unless explicitly requested
- Data stored in open formats (Markdown, plain text, SQLite) -- never locked in a proprietary format

**Keyboard-First Design**

Linear treats speed as a feature. Their keyboard-first design with rapid-fire shortcuts makes users feel like they have "superpowers" ([source](https://newsletter.pragmaticengineer.com/p/linear)). Things 3 similarly prioritizes keyboard navigation for power users. The pattern: every action should be reachable without a mouse, and the most common actions should require the fewest keystrokes.

**Minimalism as Function**

"Every removed feature is cognitive load users don't have to carry, and every simplified interface saves time in decision-making" ([source](https://www.xda-developers.com/productivity-app-that-gets-out-of-the-way/)). This isn't aesthetic minimalism; it's functional minimalism. The question for every feature: "Does this reduce friction, or add it?"

---

### UX Patterns for ADHD Users Specifically

Research and practice in 2025-2026 have converged on several principles for designing productivity software for ADHD brains:

**1. Reduce Decision Overhead**
The more options users have, the harder it is to make a decision. ADHD users struggle disproportionately with this. Limit choices. Surface one recommended action rather than five equal options. Progressive disclosure over everything-at-once ([source](https://uxpa.org/designing-for-adhd-in-ux/)).

**2. Consistency and Predictability**
"When products behave the way we expect them to, they gain our trust; when menus move and layouts shift, neurodivergent users can feel anxious" ([source](https://www.aufaitux.com/blog/neuro-inclusive-ux-design/)). Familiar patterns save brainpower. Never move UI elements between states.

**3. Visual Clarity**
Clean, minimal visual design with clear hierarchy. Avoid animated motion, harsh color palettes, intrusive alerts, and flashing elements. These are literal dysregulation triggers for ADHD and autistic users ([source](https://din-studio.com/ui-ux-for-adhd-designing-interfaces-that-actually-help-students/)).

**4. Progress Indicators**
Showing progress (steps completed, tasks pending) helps maintain focus and motivation. ADHD brains need external scaffolding to track state ([source](https://dool.agency/designing-ux-for-neurodiverse-users/)).

**5. Pull-Based Over Push-Based**
Instead of notifications and reminders (which create anxiety), let the user engage when ready. Surfaces should be "available but not demanding."

**6. Forgiveness and Re-Entry**
ADHD users will fall off habits. The tool should make re-entry trivially easy, not guilt-inducing. No streaks that break. No "you've been away for 47 days" messages.

**7. Adaptive Pacing**
The system should adapt to individual routines, preferences, and "fluctuations in energy or focus" ([source](https://arxiv.org/pdf/2507.06864)). Time-blocking and rigid scheduling actively harm ADHD productivity. Flexibility is a feature.

---

### Data Architecture

**Local-First is the Clear Winner**

For personal productivity software in 2025-2026, the local-first paradigm is dominant. The key principle: "the local device becomes the primary source of truth, and the network becomes a background optimization rather than a hard dependency" ([source](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)).

**SQLite for Desktop Apps**

SQLite is the natural fit for Tauri desktop apps. It's serverless, requires zero configuration, and the database is a single file. Tauri has an official SQL plugin that supports SQLite, with migration support built in. For Rust backends, both `rusqlite` and `sqlx` are mature options ([source](https://dev.to/focuscookie/tauri-20-sqlite-db-react-2aem)).

Performance targets for a local-first app ([source](https://blog.devstract.site/technical-deep-dive/the-rise-of-local-first-software/)):
- Sync freshness: under 3 seconds to reach another device on broadband
- Battery usage: under 1% per hour during light editing
- Storage: under 50MB for the app + 10,000 notes

**Sync Strategies**

If you eventually want multi-device sync:
- **CRDTs** (Conflict-Free Replicated Data Types) handle offline edits and automatic conflict resolution. Libraries: Automerge, Yjs.
- Things 3 built their own sync system (Things Cloud) with a custom "Fractus" engine for granular text-sync. They recently rewrote the backend from Python 2 to Swift on Kubernetes, achieving 4x faster sync processing ([source](https://culturedcode.com/things/cloud/)).
- For a personal app, start without sync. Add it later if needed.

**Data Format Decisions**

- **SQLite**: Best for structured data (tasks, projects, settings, activity logs). Gives you indexes, transactions, and queries.
- **Markdown/plain text**: Best for unstructured content (notes, journal entries). Keeps data human-readable and interoperable with tools like Obsidian.
- **Hybrid approach**: Use SQLite for the app's core data model and write/read Markdown files for content that should be portable.

---

### How Successful Indie Apps Are Architected

**Things 3** (Cultured Code)
- Native Swift on all Apple platforms
- Custom sync engine (Things Cloud) with mathematical foundation for conflict resolution
- Local database with offline-first design -- every operation works without internet
- Recently rebuilt their entire cloud backend in Swift, deployed on Kubernetes ([source](https://culturedcode.com/things/cloud/))

**Raycast**
- Native macOS core (Swift/AppKit) with React/TypeScript/Node.js extension system
- "Everything is an Extension" philosophy -- even first-party features are extensions
- Replaces Spotlight with a more extensible command palette
- Menu bar commands are not long-lived processes; loaded on demand, executed, then unloaded ([source](https://www.raycast.com/blog/how-raycast-api-extensions-work))

**Obsidian**
- Electron-based but heavily optimized
- CodeMirror 6 for the editor (heavily customized)
- Plain Markdown files on disk -- no proprietary database
- Plugin API in TypeScript lets community extend everything
- Mobile uses Capacitor (Ionic) instead of Electron ([source](https://medium.com/design-bootcamp/obsidian-app-in-depth-product-teardown-6d685930a367))

**Linear**
- TypeScript + React frontend, Node.js backend
- Real-time WebSocket sync for instant UI updates
- PostgreSQL on Google Cloud
- Speed treated as a first-class feature -- they regularly re-architect for performance
- Keyboard-first design with extensive shortcuts ([source](https://newsletter.pragmaticengineer.com/p/linear))

---

### Integration Patterns

For connecting with external tools (Todoist, Calendar, etc.):
- **REST APIs**: Todoist offers a well-documented REST API v1 with Python and JavaScript SDKs ([source](https://developer.todoist.com/api/v1/)).
- **Calendar feeds**: iCal/CalDAV for reading calendar data. macOS Calendar access via native APIs.
- **Local automation**: Apple Shortcuts, Automator, or direct AppleScript for macOS system integration.
- **Webhook-based sync**: For real-time updates from cloud services.
- **Sidecar approach in Tauri**: Run a Python or Node.js script alongside the Rust backend to handle API integrations in languages with better SDK support.

---

## 3. Building Desktop Apps with Claude Code

### Which Tech Stack is Most Productive with Claude Code?

**The clear answer: Tauri + React + TypeScript + Tailwind CSS.**

Here's why this specific stack maximizes Claude Code's effectiveness:

1. **React + TypeScript is Claude's strongest domain.** Claude has the deepest training data for React component patterns, TypeScript types, and Tailwind utility classes. You'll get the most reliable code generation here.

2. **Tauri's architecture creates a natural separation of concerns.** Frontend (React/TS) and backend (Rust) are in separate directories (`src/` and `src-tauri/`). This maps perfectly to how Claude Code works best: focused, scoped tasks on isolated parts of the codebase.

3. **Rust's compiler is Claude's safety net.** When Claude writes imperfect Rust, the compiler catches it. This is a major advantage over dynamic languages where bugs slip through silently. "Rust's powerful type system with strong safety checks acts like an expert code reviewer, automatically rejecting incorrect edits" ([source](https://medium.com/@sam.van.overmeire/just-another-observation-on-using-claude-for-rust-coding-ca9942dd9f15)).

4. **shadcn/ui components are well-documented and Claude-friendly.** Since shadcn/ui components are copied into your project (not hidden in node_modules), Claude can read, understand, and modify them directly.

5. **Existing production-ready templates** combine all these technologies with CLAUDE.md files already configured, custom slash commands, and documentation designed for AI agents ([source](https://github.com/dannysmith/tauri-template)).

### Prompting and Scaffolding Best Practices

Based on Anthropic's official best practices and community experience ([source](https://code.claude.com/docs/en/best-practices)):

**1. Plan Before Coding**
"Ask Claude to explore solutions first, starting with the simplest one, and collaborate with Claude to come up with the plan before coding." Create a spec with requirements, tech stack, design guidelines, and up to 3 milestones.

**2. Break Everything Into Atomic Subtasks**
"Claude Code handles a series of 5 precise subtasks better than a vague mega-task." Each subtask should represent 5-10 minutes of work. Never ask Claude to "build the whole app" in one prompt.

**3. CLAUDE.md is Your Most Important File**
Keep it under 300 lines. Include:
- Common bash commands (how to build, test, run)
- Code style guidelines and architectural decisions
- Key file paths and patterns
- What NOT to do (anti-patterns specific to your project)

**4. Context Window Management**
"Most best practices are based on one constraint: Claude's context window fills up fast, and performance degrades as it fills." For long sessions:
- Save intermediate results to files every 15-20 messages
- Use sub-agents for independent parallel tasks
- Keep individual prompts focused on one thing

**5. Commit Frequently**
"Develop habits like committing frequently with small, atomic commits to make it easy to rollback when AI breaks something." This is your undo button.

### How to Structure the Project for Claude Code

```
my-productivity-app/
├── CLAUDE.md                    # Project context for Claude
├── docs/
│   ├── architecture.md          # High-level architecture decisions
│   ├── data-model.md            # Database schema and data flow
│   └── features/                # Feature specs (one per file)
│       ├── task-capture.md
│       └── daily-view.md
├── src/                         # React frontend
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components
│   │   └── features/            # Feature-specific components
│   ├── hooks/                   # Custom React hooks
│   ├── stores/                  # State management
│   ├── services/                # API/backend communication
│   ├── types/                   # TypeScript type definitions
│   └── App.tsx
├── src-tauri/                   # Rust backend
│   ├── src/
│   │   ├── commands/            # Tauri command handlers
│   │   ├── db/                  # Database operations
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .claude/
│   └── commands/                # Custom slash commands
│       ├── check.md
│       └── new-feature.md
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

This structure works well because:
- Each directory has a clear, single responsibility
- Claude can focus on one directory at a time
- Feature specs in `docs/features/` give Claude context for what it's building
- The `.claude/commands/` directory packages repeatable workflows

### Recommended Development Workflow

**Phase 1: Specification (before any code)**
- Write a 1-page product brief: What does it do? Who is it for? What's the core interaction?
- Define 3-5 core features, ranked by priority
- Sketch wireframes (on paper or in Figma) for the main screens
- Write a data model: What entities exist? What are their relationships?

**Phase 2: Scaffold**
- Use a Tauri + React + shadcn/ui template to bootstrap
- Configure CLAUDE.md with project conventions
- Get a basic window rendering with routing

**Phase 3: Build Core Feature**
- Pick the single most important feature
- Write a detailed feature spec
- Break it into 5-10 subtasks
- Build each subtask with Claude Code, testing after each one
- Commit after every working state

**Phase 4: Iterate**
- Add features one at a time
- Polish UI after functionality works
- Add keyboard shortcuts progressively
- Integrate with external APIs only after core workflow is solid

**Phase 5: Polish**
- Performance optimization
- Edge case handling
- macOS-specific refinements (menu bar, tray, notifications)
- Auto-update mechanism

### Common Pitfalls When Using AI to Build Desktop Apps

**1. Scope Creep Through Easy Generation**
AI makes it trivially easy to add features, which leads to bloat. "The most successful AI software in 2026 is rarely ambitious. It's specific. The tools that survive do one thing well for one type of user" ([source](https://maze.co/collections/ai/tools-for-product-designers/)).

**2. Architecture Drift**
"AI productivity gains tank as your codebase grows -- at 10,000 lines of code you get 60% productivity gains, but at 100,000 lines those gains crater" ([source](https://addyosmani.com/blog/ai-coding-workflow/)). Prevent this by establishing architecture early and enforcing it in CLAUDE.md.

**3. Context Loss in Long Sessions**
Claude doesn't remember previous sessions. You need CLAUDE.md, feature specs, and documentation to carry context forward. Save decisions to files, not just conversation.

**4. Unpredictable Output Variation**
"Give Claude the same prompt twice, and you get different outputs" ([source](https://medium.com/@didoaint/i-built-an-app-with-claude-code-but-claude-wasnt-the-point-9540cda9a6e6)). Mitigate this by being extremely specific in prompts and having clear code style guidelines.

**5. Technical Debt Accumulation**
"As models improve, the code they produce is becoming increasingly verbose and complex, driving down obvious bugs but increasing 'code smells'" ([source](https://addyosmani.com/blog/ai-coding-workflow/)). Schedule regular refactoring sessions.

**6. Design Quality**
"Design tools with AI are not magic -- they can suggest directions, but for things like app icons you still need to drive the creative process yourself" ([source](https://medium.com/@didoaint/i-built-an-app-with-claude-code-but-claude-wasnt-the-point-9540cda9a6e6)). Leverage your design skills -- use Figma for visual design, Claude for implementation.

---

## 4. Recommendations for Marco Specifically

### The Single Best Tech Stack

**Tauri 2.0 + React + TypeScript + Tailwind CSS + shadcn/ui + SQLite (via rusqlite)**

Reasoning:
- Your React/Next.js/Tailwind skills transfer directly to the frontend. No new UI framework to learn.
- Claude Code is most effective with React + TypeScript, which is where 80%+ of your code will live.
- Tauri gives you the lightweight, fast, native-feeling experience that aligns with ADHD-friendly design (sub-500ms startup, 30-40MB memory).
- SQLite gives you a real database for structured data without any server or cloud dependency.
- shadcn/ui provides beautiful, accessible components out of the box -- you can customize the design, not build it from scratch.
- The Rust backend is minimal for a personal tool. Most of it will be database queries and file system operations that Claude can generate with compiler-assisted safety.
- If you later want to ship to iOS/Android, Tauri 2.0 supports mobile targets from the same codebase.

**Why not Electron?** Too heavy. A productivity tool that idles at 300MB and takes 2 seconds to start violates the "tool should disappear" principle. You'd feel it every time you switch to it.

**Why not SwiftUI?** Learning Swift + Xcode is a 3-6 month investment that takes you away from web technologies Claude is best at. You'd be learning a new language AND a new IDE AND a new paradigm simultaneously. The payoff (native feel) is real but not worth the friction cost for a personal tool.

**Why not Flutter?** Dart is a dead end for your career and Claude Code's capabilities. The macOS desktop experience still feels non-native.

### What to Figure Out BEFORE Writing Any Code

1. **What is the core workflow?** Describe the single thing you do most often, and how the app makes it faster. If you can't articulate this in one sentence, the idea isn't ready.

2. **What data model supports this workflow?** What are the entities (tasks, projects, notes, time blocks)? How do they relate? Sketch this on paper. The data model constrains everything.

3. **What does "done" look like for v0.1?** Define the smallest version that you'd actually use daily. Not what you dream of -- what you'd use tomorrow.

4. **What are you replacing or augmenting?** Are you replacing Todoist? Augmenting it? Building something Todoist can't do? Clarity here prevents scope creep.

5. **Menu bar app, full window app, or both?** This affects architecture. A menu bar widget and a full-window app have different interaction patterns.

### Key Architectural Decisions to Make Upfront

1. **Local-only or local-first with sync?** Start local-only. Add sync only if you actually need multi-device access. Sync is hard and can be added later.

2. **SQLite schema for your data model.** Design your tables before writing any UI code. Migrations are easy in Tauri (built-in support), but a bad initial schema creates debt.

3. **State management approach.** For a Tauri app, Zustand (lightweight, minimal boilerplate) is a good fit. Avoid Redux -- too much ceremony for a personal tool.

4. **How will you talk to external APIs?** Decide if API calls happen in Rust (more performant, more complex) or via a JavaScript sidecar (easier, familiar). For Todoist specifically, the JavaScript SDK is more ergonomic than writing HTTP calls in Rust.

5. **Keyboard shortcut architecture.** Design your shortcut scheme before building. Changing shortcuts later is technically easy but cognitively expensive (muscle memory).

### Phased Approach

**Phase 0: Clarify (1-2 days)**
- Write a 1-page product brief
- Sketch 3-5 core screens on paper
- Define your data model
- Answer the "what to figure out" questions above

**Phase 1: Scaffold and Core Loop (1 week)**
- Bootstrap from a Tauri + React + shadcn template
- Set up SQLite with your schema
- Build the single core interaction (whatever your app's "main thing" is)
- Get it running on your machine

**Phase 2: Daily Driver (2-3 weeks)**
- Add the features needed to use it daily
- Keyboard shortcuts for common actions
- Basic styling and layout
- Integration with one external service (probably Todoist)

**Phase 3: Polish and Comfort (ongoing)**
- Refine the design (you're a designer -- this is where you shine)
- Add menu bar presence if needed
- Auto-launch on startup
- Notifications if useful
- Performance tuning

**Phase 4: Optional Expansion**
- Multi-device sync (only if you need it)
- iOS/Android companion (Tauri 2.0 supports this)
- Sharing/export features

### One Final Note

Watch for the pattern you already know about: tool-building as avoidance. Building the productivity app is only valuable if it serves a specific workflow that existing tools can't handle. If Todoist + Calendar + Obsidian already cover your needs, building a custom app is procrastination dressed up as engineering. But if there's a genuine gap -- a workflow that requires jumping between three apps, or a view of your day that nothing provides -- then building it is one of the highest-leverage things you can do.

The best approach: build the smallest possible version that serves one specific need. Use it for a week. If it helps, expand. If it doesn't, you learned Tauri and Rust, and that's not nothing.

---

## Sources

- [SwiftUI for Mac 2025 - TrozWare](https://troz.net/post/2025/swiftui-mac-2025/)
- [Electron vs. Tauri - DoltHub Blog](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [Tauri vs Electron - RaftLabs](https://raftlabs.medium.com/tauri-vs-electron-a-practical-guide-to-picking-the-right-framework-5df80e360f26)
- [Why I chose Tauri instead of Electron - Aptabase](https://aptabase.com/blog/why-chose-to-build-on-tauri-instead-electron)
- [Tauri 2.0 Stable Release](https://v2.tauri.app/blog/tauri-20/)
- [Building Desktop Apps with Rust and Tauri - Plutenium](https://www.plutenium.com/blog/building-desktop-apps-with-rust-and-tauri)
- [Why Flutter Isn't Ideal for Cross-Platform Development in 2026 - KITRUM](https://kitrum.com/blog/why-flutter-isnt-ideal-for-cross-platform-development/)
- [State of Flutter 2026](https://devnewsletter.com/p/state-of-flutter-2026/)
- [React Native for macOS - Microsoft](https://github.com/microsoft/react-native-macos)
- [Neuro-Inclusive UX Design - AufaitUX](https://www.aufaitux.com/blog/neuro-inclusive-ux-design/)
- [Designing for ADHD in UX - UXPA](https://uxpa.org/designing-for-adhd-in-ux/)
- [UI/UX for ADHD - Din Studio](https://din-studio.com/ui-ux-for-adhd-designing-interfaces-that-actually-help-students/)
- [ADHD-Friendly Apps 2025 - Fluidwave](https://fluidwave.com/blog/productivity-apps-for-adhd)
- [Offline-First Frontend Apps 2025 - LogRocket](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)
- [Local-First Software - Ink & Switch](https://www.inkandswitch.com/essay/local-first/)
- [Rise of Local-First Software 2025 - Devstract](https://blog.devstract.site/technical-deep-dive/the-rise-of-local-first-software/)
- [The Architecture Shift: Local-First in 2026](https://dev.to/the_nortern_dev/the-architecture-shift-why-im-betting-on-local-first-in-2026-1nh6)
- [Things Cloud - Cultured Code](https://culturedcode.com/things/cloud/)
- [Swift Powers Things 3 Cloud - MacRumors](https://www.macrumors.com/2025/05/20/swift-powers-new-things-cloud/)
- [How Raycast API and Extensions Work](https://www.raycast.com/blog/how-raycast-api-extensions-work)
- [Obsidian Product Teardown - Medium](https://medium.com/design-bootcamp/obsidian-app-in-depth-product-teardown-6d685930a367)
- [The Story of Linear - Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/linear)
- [All I Want is a Productivity App That Doesn't Get In My Way - XDA](https://www.xda-developers.com/productivity-app-that-gets-out-of-the-way/)
- [Claude Code Best Practices - Anthropic](https://code.claude.com/docs/en/best-practices)
- [How Anthropic Teams Use Claude Code (PDF)](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf)
- [Writing a Good CLAUDE.md - HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Claude Code Best Practices - eesel.ai](https://www.eesel.ai/blog/claude-code-best-practices)
- [Tauri + React Production Template - dannysmith](https://github.com/dannysmith/tauri-template)
- [Tauri SQLite + React - DEV Community](https://dev.to/focuscookie/tauri-20-sqlite-db-react-2aem)
- [Tauri SQL Plugin Documentation](https://v2.tauri.app/plugin/sql/)
- [Claude and Rust Coding - Medium](https://medium.com/@sam.van.overmeire/just-another-observation-on-using-claude-for-rust-coding-ca9942dd9f15)
- [Claude Code and Rust - julian.ac](https://www.julian.ac/blog/2025/05/03/claude-code-and-rust/)
- [Do I Need to Know Rust for Tauri? - GitHub Discussion](https://github.com/tauri-apps/tauri/discussions/3343)
- [Todoist API v1](https://developer.todoist.com/api/v1/)
- [I Built an App with Claude Code - Medium](https://medium.com/@didoaint/i-built-an-app-with-claude-code-but-claude-wasnt-the-point-9540cda9a6e6)
- [AI Coding Workflow Going Into 2026 - Addy Osmani](https://addyosmani.com/blog/ai-coding-workflow/)
- [AI in Product Design 2026 - David Robinson](https://davidrdesign.medium.com/ai-in-product-design-where-we-are-now-in-2026-a71bceada2d8)
- [Product Designer's AI Tech Stack 2026 - Bootcamp](https://medium.com/design-bootcamp/the-designers-ai-tech-stack-for-2026-785357caa03e)
- [I'm Sick of Every PC Program Turning Into an Electron App - XDA](https://www.xda-developers.com/sick-every-pc-program-electron-app/)
- [Tauri Notifications Plugin](https://v2.tauri.app/plugin/notification/)
- [Tauri Features & Plugins](https://v2.tauri.app/plugin/)