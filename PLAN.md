# 1% — personal improvement with your party

## Goal

A mobile-friendly website where you and your friends set your own daily tasks, log measurable progress, and see one another improve in a private, synchronized party.

The central loop is: choose today's plan, do the work, record progress, and check in with your party. "1%" is the improvement philosophy, not a claim that the app can calculate a universal self-improvement score.

## Starting point and decisions

- The project directory is empty; there is no existing application or stack to preserve.
- Build a responsive web app first, usable from a phone or desktop browser.
- Parties are private and invite-only. No public feed or global leaderboard.
- Every member owns their tasks and progress. Party owners manage membership, not other people's records.
- Private tasks stay private. Only explicitly shared tasks contribute to the party view.
- The first release requires an internet connection to save progress. Do not silently present offline edits as saved.

## 1. Personal tasks

### Tracking types

| Type | Example | Controls | Completion rule |
| --- | --- | --- | --- |
| Yes / no | No junk food today | Mark done / undo | Done = complete |
| Count | 30 push-ups, 20 pages, 8 glasses of water | Add amount, quick increment, correct total | Logged amount reaches the target |
| Duration | Study for 45 minutes | Start, pause, resume, finish; manual time entry | Accumulated time reaches the target |

Count tasks have a custom unit, so reps, pages, steps, and glasses do not require separate task implementations. Duration tasks store seconds and display readable hours/minutes.

### Task options

- Title and optional description.
- Tracking type, target, and unit where applicable.
- Schedule: every day, selected weekdays, or a single date.
- Start date and optional end date.
- Visibility: only me, or shared with my selected party.
- Edit, reorder, and archive tasks.

### History rules

- Preserve each day's task definition and target; later edits must not rewrite previous days.
- Allow edits to today's plan explicitly, or schedule changes from tomorrow. Changing the tracking type after progress has been logged starts tomorrow so existing measurements are not reinterpreted.
- Archiving stops future tasks but keeps previous days and their progress.
- Undo and correction controls change logged progress without deleting the underlying task.
- Sharing a task must not retroactively publish previously private days; existing private daily snapshots remain private and sharing starts with future days.
- A running timer survives navigation and reload using persisted timestamps. Allow only one running timer per user across devices; the second device shows the existing session.
- Split timer time at the user's local day boundary so an overnight session does not put all its minutes on the wrong day. Stop a timer when its task is no longer scheduled.

## 2. Personal progress

The Today screen shows the current date, daily completion, completed-task count, and the actual task controls. Logging work is the primary action, not a promotional dashboard.

### Calculation rules

- Yes/no task progress is 0% or 100%.
- Count and duration task progress is logged amount divided by target, capped at 100% for completion calculations.
- Preserve actual totals above the target; 45/30 reps still displays 45 reps.
- Daily progress is the average progress of tasks scheduled for that day. Every task has equal weight initially.
- Show both completion percentage and completed/total tasks: partially completed work is visible without pretending the task is finished.
- A day with no scheduled tasks reads "No tasks planned", not 0% or 100%.
- Use the account's selected IANA timezone for scheduling and day boundaries, not the viewer's browser timezone. Timezone changes affect future days and do not relabel history.
- Missing logs for a scheduled task mean no progress, not that the task disappeared from the plan.

### Progress views

- Week and month views of daily completion.
- A calendar heatmap with an accessible text/list alternative.
- Per-task history with the original target and actual logged amount.
- Task streaks: consecutive scheduled occurrences completed; unscheduled days neither break nor extend the streak.
- Personal totals by compatible unit, such as minutes studied or pages read. Never add pages, reps, and minutes into one quantity.

## 3. Party experience

### Membership

- Create a party with a name and optional description.
- Invite friends through an expiring, revocable link.
- Preview the party name, then sign in and accept the invitation.
- Owner actions: rename the party, create/revoke invitations, remove members, and transfer ownership.
- Member actions: view shared progress, manage their own tasks, and leave.
- An owner must transfer ownership before leaving a party that still has other members.
- Leaving or removal revokes access to party data. Personal tasks and history remain with their owner.

### Shared party screen

- Member cards with display name, shared daily completion, and completed/shared-task count.
- Open a member to see their shared tasks, current quantities, and shared history.
- Display each member's local date and timezone when it differs from yours. "Today" means that member's current local day.
- A recent-activity list derived from authorized shared progress changes: for example, "Maya finished reading" or "Arjun logged 15 study minutes".
- Live updates without refreshing when someone logs progress, edits a shared plan, or changes membership.
- A visible connection/saving state; a failed save must preserve the entered value and offer a clear correction or retry action.

### Fair comparisons

- Each member is measured against their own shared plan, not against someone else's number of push-ups or study minutes.
- A party summary uses the average of participating members' shared daily completion, not raw mixed-unit totals.
- Members with no shared tasks scheduled show "No shared tasks planned" and are excluded from that average.
- Private tasks must not affect numbers shown to other members, because even aggregate totals can reveal private activity.
- No competitive ranking in the first release; the emphasis is mutual accountability.

## 4. Screens and interaction design

| Screen | Main purpose |
| --- | --- |
| Sign in / profile setup | Account, display name, and timezone |
| Today | Log personal tasks and see today's completion |
| Task editor | Create or edit a task with type-specific controls |
| Party | See members and their live shared progress |
| Member detail | Read one member's shared tasks and history |
| Progress | Review personal week/month and per-task history |
| Party settings | Invite management, membership, ownership, and leaving |
| Profile settings | Name, timezone, and account controls |

Use three primary destinations: Today, Party, and Progress. Put account settings behind the profile menu and party administration inside the party screen.

Visual direction: restrained dark-neutral surfaces, readable typography, one lime/green accent, compact progress indicators, and member avatars. Use the "1%" wordmark without inventing fake improvement statistics. Keep decoration secondary to usable controls.

Use a task-editor drawer on desktop and an equivalent mobile sheet. Type selection reveals only relevant fields. Inputs need labels, inline errors, preserved values after failure, visible keyboard focus, and touch-friendly controls. Progress must not depend on color alone; respect reduced-motion preferences.

## 5. Implemented architecture

The implementation uses a persistent self-hosted backend because no Supabase credentials were configured and Docker was unavailable. Authentication, multi-user persistence, and synchronization are real; there is no browser-only demo backend.

| Layer | Implementation | Reason |
| --- | --- | --- |
| Web app | Next.js + React + TypeScript | Responsive interface and same-origin JSON APIs |
| Styling | Custom responsive CSS | One shared visual system without an extra styling runtime |
| Accounts | Server-side sessions and scrypt password hashing | Works without an external identity provider |
| Database | SQLite through Node's built-in driver | Transactional relational persistence without credentials or Docker |
| Live updates | Authenticated server-sent events | Data-free invalidations followed by authorized reads |
| Hosting | One persistent Node server with writable disk | Preserves SQLite data and the process-local live event bus |

The application runs locally without external credentials. Internet sharing requires a reachable host; use HTTPS and secure cookies on a public deployment. Stateless/serverless hosting and multiple app replicas are not supported by this architecture. See README.md for commands and deployment requirements.

### Data model

- `users`: account ID, display name, email, password hash, and selected timezone.
- `user_zones`: effective-dated timezone changes so history is not relabeled.
- `sessions`: hashed session tokens with expiration.
- `parties`: name, description, owner, creation time.
- `members`: party, user, join time; unique membership. The party's owner ID determines the owner role.
- `invites`: party, hashed random token, expiry, and revocation state.
- `tasks`: owner, revision, ordering, creation date, and archive boundary.
- `task_versions`: effective-dated task definitions and schedules, including days with no logs.
- `task_days`: task, local date, original definition/timezone, sharing scope, quantity, and log timestamps; unique task/date.
- `timers`: one active server-timestamped timer per account, with its accounting cursor.

Required daily occurrences are generated server-side from versioned schedules. Future calendar plans are distinguished from historical records and are not frozen as daily snapshots before their date. Unique constraints and transactions prevent duplicate occurrences and lost increments.

### Synchronization and access rules

- SQLite is the source of truth; local UI state is not the final record.
- The server data layer checks ownership and current party membership for every operation. The browser never accesses SQLite directly.
- Only task owners can edit their tasks. Party owners manage membership but cannot edit other users' progress.
- Atomic quantity updates, transactional timer operations, and task revision conflicts protect concurrent-device changes.
- Authenticated SSE notifications contain no task data. Clients refetch authorized state on changes, reconnect, and returning to the app.
- Private task changes do not publish task data or contribute to shared summaries. Daily snapshots, history, activity, and summaries use the same sharing boundaries.
- Membership removal notifies affected open clients and clears unauthorized views. Leaving keeps the user's personal tasks/history.
- Invitations are hashed, expire after seven days, can be revoked, and require explicit acceptance.
- Session cookies are HTTP-only and same-site. POST requests reject mismatched origins. Administrative operations remain server-side.
- Timers account elapsed time across local midnight and DST boundaries. Profile timezone changes activate at the next midnight in the prior timezone.

## 6. Implementation sequence and acceptance

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| 1. Accounts and app shell | Sign-in, profile/timezone, responsive navigation, connected database | Two real accounts can sign in separately; account A cannot access account B's private records |
| 2. Personal daily tracking | All three task types, schedules, editing/archive, history snapshots, persistent timer | Create and log each type; correct a value; reload during a timer; exercise two devices; verify past days survive edits and day boundaries |
| 3. Private parties and live sync | Create/join party, invite/role controls, sharing, member details, live progress | Two browser sessions see saved shared changes without refresh; private data stays hidden; an outsider cannot read the party; removal revokes access in an already-open view |
| 4. Progress views | Weekly/monthly charts, heatmap, per-task history/streaks, party summaries | Mixed task types, partial completion, over-target totals, missed days, rest days, and different timezones produce the defined results |
| 5. Release verification and deployment | Deployed responsive app with configured auth, access policies, and error recovery | Complete the full create-task → invite-friend → log-progress → view-friend-progress journey on phone and desktop; exercise disconnected saves, reconnect, expired invites, and ownership transfer |

For each implementation stage, run the real changed path—not only unit tests. Keep regression tests for progress/date boundaries, concurrent timer/count updates, and cross-user access, where errors would affect users or expose private data.

## 7. Deliberately outside the initial release

Chat, AI coaching, wearable integrations, public discovery, rewards, and push notifications are not needed to complete the requested personal-task and live-party experience. Add them only after the core shared tracking flow works end to end.

## Definition of complete

You can create your own scheduled yes/no, count, and duration tasks; modify them without corrupting history; invite a friend; independently log work; see one another's intentionally shared progress update live; and review personal and party progress over time. The same workflow works on mobile and desktop, and an unauthorized person cannot access the party or private tasks.
