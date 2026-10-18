# Arete visual redesign: product requirements

| | |
|---|---|
| Status | Draft for review |
| Date | 16 October 2026 |
| Owner | Joseph N. |
| Scope | Visual only: design tokens, a shared component library, screen layouts. No feature changes. |
| Token source of truth | `css/theme.css` |
| Pages covered | 16 user-facing pages, the plan wizard, the shared bottom nav. Two redirect pages and two internal tools need no visual work (§2.18). |
| Visual reference | Cal AI screenshots supplied on 16 October 2026 (home, progress, logging) |

---

## 1. Summary, goals, non-goals

### 1.1 Why

Arete's features are in good shape. Its looks are not: every page has its own inline `<style>` block, and the values have drifted apart. I measured the current state across `*.html`, `css/*.css`, `features/*/ui/*.js` and `js/mobilenav.js` on 16 October 2026:

| Measure | Today | Target after redesign |
|---|---|---|
| Distinct `font-size` values | 32 (8 px to 96 px; the five most used are 12, 13, 11, 12.5 and 11.5 px) | 6 |
| Distinct `font-weight` values | 8 (300, 400, 500, 600, 650, 700, 750, 800) | 3 |
| Distinct `border-radius` values | 22 (2 px to 44 px) | 5 |
| Distinct hex colours | 139 | 27 colour tokens in `theme.css`, no raw colours anywhere else |
| Distinct `rgba()` colours | 186 | 0 outside `theme.css` |
| Distinct `box-shadow` declarations | 53 | 4 tokens |
| Gradients | 38 | 0 |
| `backdrop-filter` (frosted glass) | 40 | 0 |
| Font families | Inter (Google Fonts) on 16 pages, `-apple-system` first on `workouts.html` and in the bottom nav | 1: Inter, self-hosted |
| Bottom bars on the phone-width dashboard | 2: the dashboard's own `.mob-nav` sits under the shared `.mnav` (measured at 390 px: `.mob-nav` top 769 px, height 75 px; `.mnav` top 780 px, height 55 px) | 1 (needs decision D-1, §10.1) |

The result reads as "vibe-coded": lime glows, violet accents, gradient rings, glass bars, and 11.5 px labels beside 12.5 px labels.

### 1.2 Direction

**Clean like a diet, fast like your progression.**

The visual language comes from Cal AI: a near-white grey canvas, white cards with 24 px corners and almost no shadow, near-black ink, big bold numbers with small muted labels, thick black progress rings, a week strip, a streak pill, one black "+" button, a minimal tab bar. Colour is used only to mean something: green for done, red for missed, amber for warning.

Applied to lifting:

| Cal AI | Arete |
|---|---|
| Steps ring "9,845 / 10,000" | Weekly sessions ring "3 of 4", sets-done line in the logger, steps ring on the dashboard |
| Week strip of logged days | Planned vs completed training days (green done, red missed, dashed today, muted future) |
| Big calorie numeral | Big numbers for readiness, calories, top set, volume |
| Black "+" logs food | Black "+" starts today's workout (it already goes to `workouts.html?start=today`) |
| "Recently logged" grey rows with time chips | Session history, scheduled sessions, food diary entries |
| Line chart with dark tooltip and green banner | Weight progression, steps history; the existing weekly-streak recap line becomes the one green banner |

### 1.3 Goals

Each goal has a check that can pass or fail.

| # | Goal | How it is checked |
|---|---|---|
| G1 | Every redesigned screen draws its colours, sizes, weights, radii, shadows, spacing and durations from tokens. | The audit script in §8.3 reports zero raw values in the files changed by that phase. |
| G2 | Every card reads in the same order: label, big number, supporting line, action. | Screenshot review against §5.1 for every inventory item in the phase. |
| G3 | The app feels instant. | Press feedback starts in the same frame as the tap; tab switches have no transition; no spinners anywhere; count-ups take 300 ms and never block a tap. |
| G4 | WCAG 2.2 AA. | Contrast values in §4.1 hold; every tap target is at least 44 × 44 px; keyboard focus is visible on every control. |
| G5 | Nothing about behaviour changes. | All 141 unit tests pass; the set of `localStorage` keys written in the manual flow run is identical before and after; every item in the §8.4 flow checklist passes. |

### 1.4 Non-goals (hard rule)

- No feature, screen, flow, data field or behaviour is added, removed, renamed, merged or reordered. Anything that would need that is listed in §10.
- Routes, query strings (`?start=today`), hash routes (`#plan`, `#programs`, `#history`, `#machines`), `localStorage` keys, sync, and the global function names that inline `onclick` handlers call stay exactly as they are.
- Copy keeps its words. Two edits only: Title Case and ALL CAPS become sentence case ("Start Today's Plan" becomes "Start today's plan", "TODAY · PUSH / PULL / LEGS" becomes "Today · Push / Pull / Legs"), and the three exclamation marks in the app are dropped (§3.3).
- No dark mode. Tokens use semantic names so one can be added later (§10).
- No changes to the internal tools `muscle-editor.html` and `sandbox.html`.
- Placeholder values that are hard-coded today (§2.19) are restyled but not rewired.

---

## 2. Feature inventory and visual mapping

I built this by reading every page and every UI module on 16 October 2026. Each row is one thing a user can see or do today. "New treatment" names the component from §5 that it becomes. The ID is used again in §6, §8 and §9. Tick the box when the item is redesigned and verified in its phase.

Component names used below: Card, Collapsible card, Stat tile, Ring, Gauge, Week strip, Heat grid, Streak pill, Segmented control, Bottom nav, FAB, Sidebar, Page header, Back link, List row, Set row, Line chart, Bar chart, Sparkline, Banner, Sheet, Full-screen sheet, Popover, Toast, Empty state, Skeleton, Text input, Number input, Select, Search field, Stepper, Slider, Checkbox, Chip, Progress bar, Body map, and buttons (Primary, Secondary, Text, Destructive, Icon).

### 2.1 Global

| ✓ | ID | What exists today | Where | New treatment |
|---|---|---|---|---|
| [ ] | G-01 | Desktop sidebar (≥768 px): "Arete" logo, "Main" and "Life" groups, page links, user footer (initial avatar, "Joseph N.", "Arete Pro"). The link list differs between pages (for example `steps.html` lists Steps, `consistency.html` leaves out Finance). | every page except login | Sidebar (§5.23). Each page keeps its own link list (OS-07). |
| [ ] | G-02 | "‹ Dashboard" back link at ≤767 px, frosted sage background | 14 sub-pages | Back link (§5.22), no blur. |
| [ ] | G-03 | Shared bottom nav at ≤767 px: Home, Train, Food, More | `js/mobilenav.js` | Bottom nav (§5.7), four tabs, same order. |
| [ ] | G-04 | Black centre "+" ringed in lime, goes to `workouts.html?start=today` | `js/mobilenav.js` | FAB (§5.8) at bottom right, same link. |
| [ ] | G-05 | "More" sheet: Recovery, Habits, Sleep, Connections, Exercises, Progress, Consistency, Finance, Settings | `js/mobilenav.js` | Sheet with nine List rows (icon, label, chevron), same order. |
| [ ] | G-06 | Dashboard's own bottom bar: Home, Train, Arete (focuses the Arete input), Recovery, Nutrition. Drawn underneath G-03. | `index.html` `.mob-nav` | Restyled with tokens; see decision D-1. |
| [ ] | G-07 | Cross-page fade (view transitions, 200 ms) | `css/touch.css` | Kept; `--dur-base`, `--ease`. |
| [ ] | G-08 | Press feedback: scale 0.94 with an overshoot curve | `css/touch.css` | Scale 0.97, `--dur-fast`, `--ease`, no overshoot. |
| [ ] | G-09 | Keyboard focus ring, 2 px violet | `css/touch.css` | 2 px `--color-ink` outline, 2 px offset. |
| [ ] | G-10 | Toasts | workouts, habits, nutrition, connections, connected-health | Toast (§5.14). |
| [ ] | G-11 | Page title and subtitle (`.ph-title`, `.ph-sub`) with right-side actions | every page | Page header (§5.21). |
| [ ] | G-12 | Offline caching (`sw.js`), auth guard, redirect pages | `sw.js`, `js/authguard.js`, `tasks.html`, `programs.html` | No visual change. `sw.js` `VERSION` goes up each phase. |

### 2.2 Dashboard (`index.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | D-01 | Greeting "Good morning, Joseph" (static text) | 14 px label, `--color-ink-secondary` |
| [ ] | D-02 | Sub-line "Your lower body is fully recovered…" (static) | 20 px semibold, `--color-ink` |
| [ ] | D-03 | Date "Saturday / Jun 14, 2026" (static; hidden by an existing media rule) | 14 px label; visibility rules unchanged |
| [ ] | D-04 | Check-in button (sun icon) with pending dot | Icon button 44 px; 8 px `--color-danger` dot |
| [ ] | D-05 | Notifications button with dot (no action attached) | Icon button 44 px; see OS-03 |
| [ ] | D-06 | Streak "6 days" (static) | Streak pill (§5.5) |
| [ ] | D-07 | Avatar "J" with gradient | 36 px circle, `--color-surface-muted`, initial 14 px semibold |
| [ ] | D-08 | Consistency card: Training / Code toggle (`arete_cons_src`), "See all" → `consistency.html`, headline, month labels, 52-week grid, stats (This week, Active days (30d), Workouts 2026, Last workout) | Card + Segmented control (small) + Text button + Heat grid (§5.18) + four inline Stat tiles |
| [ ] | D-09 | Daily readiness card: gradient ring with score (shows 82 until a check-in sets it), "Ready" label, eyebrow, copy (static), Sleep / Energy / Mood / Sleepiness, "Start Today's Plan", "Adjust Plan" (no action attached), "Readiness this week" sparkline (static) | Card + Ring L (§5.3) + four compact Stat tiles + Primary + Secondary buttons + Sparkline |
| [ ] | D-10 | "Explore" app grid at ≤767 px: Habits, Sleep, Connections, Progress, Exercises, Nutrition, Finance, Settings, each with its own tint colour | 4-column grid of tiles: 24 px ink icon in a 48 px `--color-surface-muted` circle, 12 px label. All tints removed. |
| [ ] | D-11 | Today's Workout (collapsible): name, Program, Exercises, Sets, ~Time, muscle tags, "Full plan" → `workouts.html#plan`, start | Collapsible card + four Stat tiles + Chips + Text button + Primary button |
| [ ] | D-12 | Tasks "Today": progress bar, add input + Add, rows with toggle and delete, empty text | Collapsible card + Progress bar + Text input + Primary S button + List rows with Checkbox + inline Empty state |
| [ ] | D-13 | Today's Focus (habits for today) | Collapsible card + List rows with Checkbox |
| [ ] | D-14 | Muscle Recovery: body image with SVG overlay, legend (Ready, Recovering, Fatigued, Rest, No data), stat line; popover (desktop) or bottom sheet (phone) with Recovery %, Last trained, Sets performed, Est. recovery, Days remaining, tip | Collapsible card + Body map (§5.19) + legend dots + Popover / Sheet + Progress bar |
| [ ] | D-15 | Nutrition: kcal of 2,650 and %, Protein / Carbs / Fats / Water bars, "Log Meal", camera button | Collapsible card + 40 px numeral + four Progress bars (all ink) + Primary button + Icon button |
| [ ] | D-16 | Sleep: Score 78, Total 6h 52m, Bed, Wake, Consist., sparkline, insight line (all static) | Collapsible card + Stat tiles + Sparkline |
| [ ] | D-17 | Steps card (phone only, `features/steps`) | Card + Ring L with footprints icon (the Cal AI steps card) |
| [ ] | D-18 | Step permission / manual entry panel | Card + Primary / Text buttons |
| [ ] | D-19 | Energy Intelligence: Early / Neutral / Late, 270° gauge, status, three-curve forecast with legend, Peak Energy / Best Focus / Workout Window / Dip / Rest, confidence line, "Log energy" | Collapsible card + Segmented (small) + Gauge (§5.3) + Line chart with three line styles + four Stat tiles + Text button |
| [ ] | D-20 | Arete input: text area, voice, send, five prompt chips | Text input (multi-line) + two Icon buttons + Chips |
| [ ] | D-21 | Section collapse (`dashToggle`, `arete_dash_open`) with summary text when closed | Collapsible card header (§5.1) |
| [ ] | D-22 | Morning check-in overlay, seven phases: onboarding sleep schedule, late-day prompt, greeting, data source (Apple, WHOOP, questions), questions with slider and progress, thinking, results (score, label, date, summary, strengths, recommendation). Glowing animated orb. | Full-screen sheet (§5.12); orb becomes a static 96 px circle (§6.1.8) |
| [ ] | D-23 | Energy observation prompt | Sheet |

### 2.3 Training (`workouts.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | T-01 | Page header "Training" (hidden during a workout) | Page header |
| [ ] | T-02 | Tabs Today / Plan / History / Machines (`#programs` and `#coaching` open sections of Plan) | Segmented control, four segments |
| [ ] | T-03 | Resume hero for a workout in progress | Card (hero) + Primary button |
| [ ] | T-04 | Plan card (`planHome.js` `renderPlanHome`): "<plan> · <frequency>", Edit plan, done badge, when / title / sub, exercise list "sets × reps · RIR", Start Workout or Start early, 7-day strip (done, missed, planned, rest, today), "x of y this week · %", upcoming rows with Start | Card + Text button + List rows + Primary button + Week strip (§5.4) + Ring S showing x of y |
| [ ] | T-05 | Plan empty card: "Plan your week once. Arete schedules every session.", Create training plan / Continue setting up your plan | Empty state in a Card |
| [ ] | T-06 | Program-day hero: "Today · <program>", day name, date, exercise rows, Start workout | Card (hero) |
| [ ] | T-07 | "Ready to train?" hero (no program) | Card (hero) |
| [ ] | T-08 | "Train to a weekly plan" setup card, Set up plan | Card + Secondary button |
| [ ] | T-09 | "Other ways to train" list (Empty workout and others) | List rows |
| [ ] | T-10 | Scheduled sessions list | List rows with date chip |
| [ ] | T-11 | Plan tab overview (`renderPlanOverview`): plan name, frequency, "x of y done this week", Edit plan, This week rows (day, date, workout, Done / Missed / Today / Start), Workouts in this plan (expandable) | Card + List rows with status chip + disclosure rows |
| [ ] | T-12 | Programs section (`#pl-programs`): program cards, "Example program — edit or replace with your own plan." note, preset picker, program editor rows | Card + List rows + Sheet |
| [ ] | T-13 | Programs catalogue panel: multi-select exercise list including "Machine exercises" | Sheet + List rows with Checkbox + sticky footer |
| [ ] | T-14 | Coaching section (`#pl-coaching`, shareable training files) | Card with disclosure |
| [ ] | T-15 | History tab: stats, session rows, session detail with Repeat | Stat tiles + List rows with time chip + Sheet |
| [ ] | T-16 | Physique section and physique sheet (photo grid) | Card + 3-column photo grid (12 px radius) + Sheet |
| [ ] | T-17 | Machines tab browser: search, filters, count, rows, details | Search field + Selects + List rows + Sheet |
| [ ] | T-18 | Logger top bar: workout name, "x of y sets done", Finish, progress line | Sticky bar (§6.2.2) |
| [ ] | T-19 | Exercise card: name (opens weight progression), plate calculator, remove exercise, Target and Last time line, machine block, set table header (Set, kg, Reps, RIR, Done), + Add set | Card + Set rows (§5.10) |
| [ ] | T-20 | Set row: set tag (number or W, toggles warm-up), kg, reps, RIR with placeholders from last time and targets, done toggle with PR state, remove set | Set row |
| [ ] | T-21 | Logger empty state "No exercises yet" | Empty state |
| [ ] | T-22 | "＋ Add exercise" | Secondary button, full width, plus icon |
| [ ] | T-23 | "＋ Add a note" → notes text area | Text button → multi-line Text input |
| [ ] | T-24 | Save as routine, Save for later, Discard workout | Text buttons; Discard is Destructive text |
| [ ] | T-25 | Side panel (two columns ≥921 px, stacked below): Muscles worked (body diagram, Primary / Secondary legend, targets, note), This session (Exercises, Working sets, Sets completed, Muscle groups) | Card + Body map + List rows |
| [ ] | T-26 | Rest timer pill | Floating pill (§6.2.5) |
| [ ] | T-27 | Plate calculator | Sheet |
| [ ] | T-28 | Weight progression (opened from an exercise name) | Sheet + Line chart with tooltip (§5.11) |
| [ ] | T-29 | Add exercise sheet: Machines / Exercises; machine search, Muscle group and Brand filters, count, rows (name, type, resistance profile, muscle action), info → details, combo choices, cable-station select; Exercises search and rows | Sheet + Segmented + Search field + two Selects + List rows + inline choice row |
| [ ] | T-30 | Machine details sheet with Add | Sheet |
| [ ] | T-31 | Schedule sheet (`plan-modal`) | Sheet |
| [ ] | T-32 | Video workout import (AI) | Sheet + Skeleton + error Banner |
| [ ] | T-33 | Finish: validation toasts, then "Logged! N muscle groups now recovering" or "Logged · x of y sessions this week" | Toast; "Logged!" becomes "Logged ·" (§3.3) |
| [ ] | T-34 | "Photo saved — N-day streak!" toast, "Personal record!" tooltip | Toast; exclamation marks dropped |

### 2.4 Plan wizard (`features/training/ui/planWizard.js`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | W-01 | Top bar: Close, "New training plan" or "Edit plan", "n of 4" | Full-screen sheet top bar |
| [ ] | W-02 | Step progress: Split, Days, Workouts, Review (tappable up to the furthest step reached) | Four 4 px segments with 12 px labels |
| [ ] | W-03 | Split cards (8): Push / Pull / Legs, Upper / Lower, Anterior / Posterior, Full Body, Full Body Every Other Day, Upper / Lower / Push / Pull / Legs, Upper / Lower / Full Body, Custom Split | Selectable List rows (§6.3.3) |
| [ ] | W-04 | Custom split panel: Split name, workout names, remove, "＋ Add workout" | Text inputs + Icon buttons + Text button |
| [ ] | W-05 | Days (weekly): weekday toggles ×7, "Recommended for …" badge or "Use recommended" link, Each new week (Continue the rotation / Restart), First week rows, Week after strip | Day toggles + Chip + Text button + Segmented + List rows + Week strip (preview variant) |
| [ ] | W-06 | Days (every other day): first training day date, explainer, "Your next five weeks" calendar | Text input (date) + 5-week calendar (§6.3.4) |
| [ ] | W-07 | Day → workout selects (custom split) | List rows with Select |
| [ ] | W-08 | Workouts: one expandable section per workout (name, meta, chevron; flagged when a scheduled workout has no exercises) | Disclosure Card; flag uses `--color-warning` |
| [ ] | W-09 | Exercise row: number, name, move up, move down, duplicate, remove, Sets, Reps min–max, RIR, machine (chosen summary + Remove machine, or "＋ Choose machine" with database count) | Card (muted) + Icon buttons + Number inputs + List row |
| [ ] | W-10 | "＋ Add exercise", "Use starter template", "Remove <workout>", "＋ Add another …", rotation note | Secondary S buttons + Destructive text button + caption |
| [ ] | W-11 | Review: Split, Frequency, Starts, New weeks; Schedule + Edit; Workouts + Edit (with machine names); Overlap & coverage; warning + Fix; End this plan (tap twice) | Stat list + List rows + Card + warning Banner + Destructive text button |
| [ ] | W-12 | Footer: error text, Back, Continue / Start Training Plan / Save Plan (disabled until a split is picked) | Sticky footer: Secondary L + Primary L |
| [ ] | W-13 | Overlap & coverage panel (`features/exercises/ui/overlapPanel.js`) | Card (muted) + List rows + Chips |

### 2.5 Consistency (`consistency.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | C-01 | Header "Consistency" + sub | Page header |
| [ ] | C-02 | Training / Code toggle | Segmented control |
| [ ] | C-03 | Year with previous / next | Two Icon buttons + 20 px year |
| [ ] | C-04 | Heat grid (scrolls sideways), updated time, "Planned" key, Less / More legend | Heat grid + caption + legend dots |
| [ ] | C-05 | Stats row | Stat tiles |
| [ ] | C-06 | Weekly completion list | List rows with Progress bar |
| [ ] | C-07 | Day detail card ("Tap a square to see that day.") | Card + Empty state |

### 2.6 Progress (`analytics.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | P-01 | Header "Progress" + sub | Page header |
| [ ] | P-02 | Workouts this week, Volume this week, Training streak, PRs — 30 days | Four Stat tiles (2 × 2 on phone) |
| [ ] | P-03 | "Your week" recap list and Share (share image) | Card + list; the existing streak line ("N weeks in a row… Consistency is the whole game.") is drawn as the Banner (§5.13) in its current position |
| [ ] | P-04 | Consistency — last 16 weeks | Heat grid |
| [ ] | P-05 | Weekly training volume | Bar chart |
| [ ] | P-06 | Personal records | List rows with date chip |
| [ ] | P-07 | Strength — your main lifts | List rows with Sparkline |
| [ ] | P-08 | Muscle balance — last 4 weeks | List rows with Progress bar |
| [ ] | P-09 | Life — last 30 days | Stat tiles |

### 2.7 Recovery (`recovery.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | R-01 | Header + "Log workout" | Page header + Secondary S button |
| [ ] | R-02 | Summary bar | Stat tiles |
| [ ] | R-03 | Legend: Ready, Mostly recovered, Partial, Fatigued, Heavy fatigue, No data | Legend dots using the recovery ramp (§4.1.4) |
| [ ] | R-04 | Front / Back toggle | Segmented control |
| [ ] | R-05 | Body map | Body map |
| [ ] | R-06 | "All Muscles" grid | List rows with Progress bar |
| [ ] | R-07 | Muscle popover | Popover (desktop) / Sheet (phone) |

### 2.8 Nutrition (`nutrition.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | N-01 | Header + sub | Page header |
| [ ] | N-02 | Day navigation: previous, "Today" / date (tap returns to today), next | Two Icon buttons + 16 px semibold label |
| [ ] | N-03 | Scan, Goals | Primary S + Secondary S |
| [ ] | N-04 | Calorie ring (Eaten, of goal), big number, "/ goal Calories", "N left" | Ring L + 40 px numeral + labels |
| [ ] | N-05 | Protein, Carbs, Fat bars | Progress bars (ink) with 14 px values |
| [ ] | N-06 | Diary / Nutrients | Segmented control |
| [ ] | N-07 | Water: litres of goal, bar, − / + 250 ml | Card + Progress bar + Stepper (the Cal AI water card) |
| [ ] | N-08 | Meals with entries and add | Card per meal + List rows + Text button |
| [ ] | N-09 | Nutrients view (coverage, nutrient groups) | Card + List rows with Progress bar |
| [ ] | N-10 | Add food sheet: search, category chips, results, Scan a barcode, Estimate from a photo (AI), Create a custom food | Sheet + Search field + Chips + List rows |
| [ ] | N-11 | AI photo screen: status, name, serving, four values, detected items, note, meal picker, Retake, Add to diary | Sheet screen + Skeleton + Stat tiles + Chips + buttons |
| [ ] | N-12 | Portion screen: Servings / Grams, − qty +, "× 1 serving", four values, meal picker, Remove / Cancel / Add to diary | Sheet screen + Segmented + Stepper + Stat tiles |
| [ ] | N-13 | Custom food form | Text and Number inputs |
| [ ] | N-14 | Barcode scanner: camera stage, status, take a photo, Scan again, Add as custom food, manual number + Look up, Open Food Facts credit | Sheet + 16 px radius video frame + buttons |
| [ ] | N-15 | Daily goals: kcal, protein, carbs, fat, water, tip, Reset / Cancel / Save Goals | Sheet + Number inputs |

### 2.9 Sleep (`sleep.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | S-01 | Header + "Log sleep" | Page header + Primary S |
| [ ] | S-02 | Last night: hours, meta, Quality, Mid-sleep, vs 8h target | Card + 40 px numeral + three Stat tiles |
| [ ] | S-03 | Alertness ring, "Homeostatic alertness", explainer | Ring M + text |
| [ ] | S-04 | Last 7 nights: bars and quality dots | Bar chart |
| [ ] | S-05 | Avg duration, Avg quality, Consistency, 7-day debt | Four Stat tiles |
| [ ] | S-06 | Sleep history | List rows with date chip |
| [ ] | S-07 | Log sheet: night of, fell asleep, woke up, quality slider, duration preview, Cancel / Save night | Sheet + Text inputs + Slider |

### 2.10 Steps (`steps.html`, `features/steps`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | ST-01 | Header + sub | Page header |
| [ ] | ST-02 | Daily goal input | Number input with unit |
| [ ] | ST-03 | History: chart, Weekly average, Best day, Goal-completion days, Current streak, This month | Bar chart + Stat tiles |
| [ ] | ST-04 | Permission card: Enable step tracking, Enter steps manually, Not now, Step tracking is on | Card + buttons + success Banner |

### 2.11 Habits (`habits.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | H-01 | Header + New habit | Page header + Primary S |
| [ ] | H-02 | Hero: Character level, XP, to next level, skills, perfect days | Card + 40 px numeral + Progress bar + Stat tiles |
| [ ] | H-03 | Today's quests: rows with check-in and +XP | List rows with Checkbox and value |
| [ ] | H-04 | "Perfect day — all quests cleared. +N XP" | Banner |
| [ ] | H-05 | Skills: XP, next level, combo | List rows with Progress bar |
| [ ] | H-06 | New habit sheet: Name, Cue (At a time / At a place / After a habit), cue text, Cancel / Add skill | Sheet + Text input + Segmented |
| [ ] | H-07 | Level-up and perfect-day toasts | Toast |

### 2.12 Exercises (`exercises.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | E-01 | Header "Exercise Database" + Add Exercise | Page header + Primary S |
| [ ] | E-02 | Exercises / Muscles | Segmented control |
| [ ] | E-03 | Muscles view: intro, search, muscle group, resistance profile, count, list, update notes | Search field + Selects + List rows + Card |
| [ ] | E-04 | Exercises view: notice, search, category, equipment, "My exercises" chip, count, stats, table (Exercise, Category, Equipment, Primary, Secondary, Source) | Search + Selects + Chip + table (§6.4) |
| [ ] | E-05 | Add / edit exercise sheet with validation | Sheet + inputs + error text |

### 2.13 Connections (`connections.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | CN-01 | Header + intro | Page header |
| [ ] | CN-02 | "Connect once, sync forever." explainer | Card |
| [ ] | CN-03 | Link to Connected Health | List row with chevron |
| [ ] | CN-04 | Provider cards (`js/wearables.js`): Apple Watch, Fitbit, Garmin, Health Connect, Heart Rate Monitor, Oura Ring, Strava, WHOOP; Connect, Connected, Disconnect, Sync now, Live HR, HRV, Resting HR, Last activity, Coming soon | List rows (40 px icon circle, name, status chip, action) |
| [ ] | CN-05 | Oura token sheet | Sheet + Text input + error text |

### 2.14 Connected Health (`connected-health.html`, `features/health/ui`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | CH-01 | Header, intro, link to Connections | Page header + Text button |
| [ ] | CH-02 | Sources, Source preferences, Import history from, Sync now | Card + List rows + Selects + Secondary button |
| [ ] | CH-03 | Permission dialog | Sheet |
| [ ] | CH-04 | Sleep suggestion: Use detected value / Keep my answer | Banner with two Text buttons |

### 2.15 Settings (`settings.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | SE-01 | Header + sub | Page header |
| [ ] | SE-02 | Daily readiness source: Ask me each morning, Apple Watch, WHOOP, Daily questions | Selectable List rows |
| [ ] | SE-03 | AI features: key field, Save key, Remove, status, console link | Card + Text input + buttons |
| [ ] | SE-04 | Account: signed-in email, Sign out | Card + List row + Destructive text button |
| [ ] | SE-05 | "More settings coming soon", back link | Caption + Text button |

### 2.16 Login (`login.html`)

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | L-01 | Logo, title, sub | 28 px title + 16 px sub |
| [ ] | L-02 | Configuration notice | Warning Banner |
| [ ] | L-03 | Create account / Sign in | Segmented control |
| [ ] | L-04 | Google, Apple, Facebook | Secondary L buttons with brand marks (brand colours allowed only inside the marks) |
| [ ] | L-05 | "OR WITH EMAIL" divider | "Or with email", 12 px caption between hairlines |
| [ ] | L-06 | Email / Phone | Segmented control (small) |
| [ ] | L-07 | Email, Password, hint, submit, Forgot password? | Text inputs + Primary L + Text button |
| [ ] | L-08 | Phone, hint, code, Send code | Text inputs + Primary L |
| [ ] | L-09 | Message area, mode switch, legal line | Banner (error or success) + Text button + caption |

### 2.17 Finance and Goals

| ✓ | ID | What exists today | New treatment |
|---|---|---|---|
| [ ] | F-01 | Finance: header, sub, "Coming soon", back link | Page header + Empty state |
| [ ] | GO-01 | Goals: header, sub, "Coming soon", back link | Page header + Empty state |

### 2.18 No visual work

`tasks.html` (redirects to the dashboard), `programs.html` (redirects to `workouts.html#programs`), `muscle-editor.html` and `sandbox.html` (internal tools; they do not load `theme.css`).

### 2.19 Placeholder and sample values on screen today

The design rule is "no fake numbers". These exist today. Wiring them to real data would change behaviour, so the redesign shows them exactly as now and §10 lists the fix.

| Where | Value | Kind |
|---|---|---|
| `index.html:706` | "Good morning, Joseph" | static text |
| `index.html:710` | "Saturday / Jun 14, 2026" | static text |
| `index.html:721` | "6 days" streak | static text |
| `index.html:758` | readiness "82" | shown until the first check-in of the day |
| `index.html:765` | readiness copy | static text |
| `index.html` `.ready-spark` | "Readiness this week" line and "82" | static SVG |
| `index.html:972–990` | Sleep 78, 6h 52m, 11:48 PM, 6:40 AM, 84%, sparkline, "38 minutes below your 7h 30m target." | static text and SVG |
| `js/fitness.js:593` `seedMockData()` | three sample workouts (Push Day, Leg Day, Pull Day) for new users; called from `index.html:1368`, `recovery.html:303`, `workouts.html:535` | seeded sample data |
| `workouts.html:2331` | example programs, labelled "Example program — edit or replace with your own plan." | labelled examples (fine) |
| every sidebar | "Joseph N.", "Arete Pro" | static text |

---

## 3. Principles and the anti-vibe-coded checklist

### 3.1 Principles

1. **White on grey.** Cards are `#FFFFFF` on a `#F5F5F7` canvas. Cards have no border and one 4% shadow. The contrast between card and canvas does the separating.
2. **Ink does the work.** Text, rings, primary buttons, the FAB and the active tab are `--color-ink`. Colour appears only when it means something: green for done, red for missed or destructive, amber for warning and the streak flame.
3. **Numbers first.** Every card reads label (14 px) → number (28 or 40 px, bold, tabular) → supporting line (12 or 14 px) → action.
4. **One loud thing per view.** At most one Primary button is visible per phone viewport, not counting sheet footers. Everything else is Secondary or Text.
5. **Nothing waits for animation.** Feedback starts in the same frame as the tap. Motion confirms; it never gates.
6. **Same thing, same look.** Anything that appears twice is a §5 component. No page invents its own card, row or button.

### 3.2 Anti-vibe-coded checklist

Copy this list into every phase's pull request and tick it for every changed file.

- [ ] One type family: Inter. No `font-family` outside `theme.css`.
- [ ] Font sizes only 12, 14, 16, 20, 28, 40 px.
- [ ] Font weights only 400, 600, 700.
- [ ] Every number that can change uses `font-variant-numeric: tabular-nums`.
- [ ] Padding, margin and gap only 0, 4, 8, 12, 16, 24, 32 px. Fixed layout sizes (nav height, sidebar width) come from the layout tokens in §4.7.
- [ ] Radius only 8, 12, 16, 24 px or full.
- [ ] No gradients of any kind: not on buttons, rings, avatars, icons, banners or backgrounds.
- [ ] No `backdrop-filter`, blur or glass.
- [ ] No emoji or text characters used as icons (✕ ✓ ⚠︎ ＋ − ‹ →). Use the icon set.
- [ ] No neon or decorative accents: lime `#58DB3D`, violet `#5E5CE6`, `#A78BFA`, `#38BDF8`, `#3B82F6`, `#0E9CC0` and the like are gone.
- [ ] Colour only from §4.1, and only with the meaning given there.
- [ ] At most one shadow per element, from an elevation token. Never a shadow and a border on the same element.
- [ ] Cards have no outline or border.
- [ ] Icons from one set, stroke 1.75 (in the 24-unit viewBox), sizes 16, 20 or 24 px.
- [ ] Cards follow label → number → supporting line → action.
- [ ] Every area that loads, can be empty or can fail has the states in §5.15 and §5.16. No spinners.
- [ ] No fake or sample numbers added by the redesign. Mock-ups use empty states or the test fixtures.
- [ ] Copy in sentence case. No ALL CAPS eyebrows. No exclamation marks.
- [ ] Durations only 120, 200 or 300 ms with `--ease`. Reduced motion honoured. No animation blocks input.
- [ ] Tap targets at least 44 × 44 px.
- [ ] Text contrast at least 4.5:1; icons, rings and control edges at least 3:1.

### 3.3 Copy rules

- Sentence case everywhere, including buttons, tabs and section titles. Words stay the same.
- No ALL CAPS. Today's uppercase eyebrows ("TODAY · PUSH / PULL / LEGS", "READY", "WORK / SCHOOL DAYS", "OR WITH EMAIL") become sentence case.
- The app has three exclamation marks today; all three go: "Logged! …" becomes "Logged · …" (`workouts.html:1191`), "Photo saved — N-day streak!" becomes "Photo saved · N-day streak" (`workouts.html:1370`), and the tooltip "Personal record!" becomes "Personal record" (`workouts.html:838`).
- The one encouragement line is the existing Progress recap line "N weeks in a row with at least one session. Consistency is the whole game." (`analytics.html:244`), drawn as the green Banner. Its words don't change.
- Glyphs inside copy become icons: "＋ Add set" becomes a plus icon + "Add set", "→" in links becomes a chevron icon, "⚠︎" in the nutrition AI note becomes the alert icon.

---

## 4. Design tokens

All tokens live in `css/theme.css`. Every page already loads `theme.css` after its inline `<style>` block (for example `index.html:626`), so these values win without touching each page. The current sage and lime values in `theme.css` are replaced. Old per-page token names stay as aliases until the clean-up phase (§4.9).

### 4.1 Colour (light mode)

Contrast ratios were calculated with the WCAG 2.x formula.

#### 4.1.1 Surfaces and lines

| Token | Value | Use |
|---|---|---|
| `--color-canvas` | `#F5F5F7` | Page background, full-screen sheets |
| `--color-surface` | `#FFFFFF` | Cards, sheets, bottom nav, sidebar, inputs inside Set rows |
| `--color-surface-muted` | `#F0F0F3` | List rows inside cards, input fields, segmented track, skeletons, icon circles |
| `--color-surface-pressed` | `#E6E6EA` | Pressed rows, pressed Secondary buttons |
| `--color-line` | `#E8E8EC` | Ring and bar tracks, empty heat cells, 1 px dividers inside cards |
| `--color-scrim` | `rgba(17, 17, 19, 0.40)` | Behind sheets and dialogs |

#### 4.1.2 Ink

| Token | Value | On surface | On canvas | On muted | Use |
|---|---|---|---|---|---|
| `--color-ink` | `#111113` | 18.86 | 17.32 | 16.58 | Primary text, numbers, rings, Primary buttons, FAB, active tab |
| `--color-ink-pressed` | `#2B2B30` | | | | Pressed Primary button and FAB |
| `--color-ink-secondary` | `#52525B` | 7.73 | 7.10 | 6.80 | Labels, secondary text, inactive segment text |
| `--color-ink-tertiary` | `#6B6B74` | 5.28 | 4.85 | 4.64 | Captions, units, inactive tab icons, axis labels. Never on `--color-surface-pressed` (4.24). |
| `--color-ink-disabled` | `#A1A1AA` | 2.56 | | | Disabled text only (WCAG exempts disabled controls) |
| `--color-on-ink` | `#FFFFFF` | 18.86 on ink | | | Text and icons on ink |
| `--color-on-ink-secondary` | `#B8B8C0` | 9.57 on ink | | | Secondary text in tooltips and toasts |

#### 4.1.3 Meaning

| Token | Value | Contrast | Means |
|---|---|---|---|
| `--color-success` | `#178F4A` | 4.15 on surface, 3.81 on canvas | Done: set done, day done, goal met, connected, PR, ready muscle. Fills, rings, icons. |
| `--color-success-ink` | `#11733A` | 5.94 on surface, 5.26 on tint | Text that means done |
| `--color-success-tint` | `#E5F5EB` | | Done row background, the encouragement Banner |
| `--color-danger` | `#E0393E` | 4.35 on surface, 4.00 on canvas | Missed day, unread dot, heavy fatigue / rest muscle, destructive icons |
| `--color-danger-ink` | `#B42328` | 6.54 on surface, 5.67 on tint | Error text, destructive button text |
| `--color-danger-tint` | `#FCEBEB` | | Error Banner, Destructive button background |
| `--color-warning` | `#CC6A00` | 3.73 on surface, 3.43 on canvas | Needs attention, streak flame, fatigued muscle |
| `--color-warning-ink` | `#8A4B00` | 6.80 on surface, 6.12 on tint | Warning text |
| `--color-warning-tint` | `#FFF1DE` | | Warning Banner |

#### 4.1.4 Data ramps

These are the only colours allowed to show a quantity.

| Token | Value | Use |
|---|---|---|
| `--color-heat-1` | `#CFEFDB` | Heat grid, lowest completion |
| `--color-heat-2` | `#97DBB0` | |
| `--color-heat-3` | `#52BE80` | Also "Mostly recovered" |
| `--color-heat-4` | `var(--color-success)` | Full completion |
| (empty cell) | `var(--color-line)` | No session / no data |
| `--color-recovery-partial` | `#E2A40F` | "Partial" (Recovery page) and "Recovering" (dashboard) |

Recovery ramp, worst to best: Heavy fatigue and Rest = `--color-danger`; Fatigued = `--color-warning`; Partial and Recovering = `--color-recovery-partial`; Mostly recovered = `--color-heat-3`; Ready = `--color-success`; No data = `--color-line`. The rules that decide each state are unchanged.

Charts that show several series at once (the three Energy Intelligence curves) separate them by line style, not colour: solid, dashed (4 4), dotted (1 4), all in ink tones (§5.11).

The two body diagrams (Muscle Recovery, Muscles worked in the logger) keep the ramp above. "Primary" and "Secondary" in the logger diagram become `--color-ink` at 85% and 35% fill opacity instead of violet.

#### 4.1.5 Totals

27 colour tokens: 6 surface, 7 ink, 9 meaning, 5 data (`--color-heat-4` is an alias). No other colour may appear in a page, stylesheet or UI module. Exceptions: brand marks on the login buttons (L-04) and provider logos (CN-04), which are images.

### 4.2 Typography

**Family.** `--font-sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;`. Inter becomes self-hosted (variable font, Latin subset, `woff2`, about 100 KB) under `fonts/`, declared once in `theme.css` with `font-display: swap`, and added to the `sw.js` precache so it works offline. The 16 Google Fonts `<link>` tags are removed in the clean-up phase. `workouts.html` and `js/mobilenav.js` stop putting `-apple-system` first.

**Weights.** `--weight-regular: 400`, `--weight-semibold: 600`, `--weight-bold: 700`. Nothing else.

**Scale.** Defined in `rem` on a 16 px root (12 px = 0.75rem), so browser text-size settings apply.

| Token | Size / line height | Letter spacing | Roles |
|---|---|---|---|
| `--text-12` | 12 / 16 px | 0 | Captions, units, chips, tab labels, axis labels, table headers |
| `--text-14` | 14 / 20 px | 0 | Labels, secondary text, list subtitles, small buttons |
| `--text-16` | 16 / 24 px | 0 | Body, list titles, inputs (16 px stops iOS zoom), buttons |
| `--text-20` | 20 / 28 px | −0.01em | Card titles, sheet titles, workout name in the logger |
| `--text-28` | 28 / 34 px | −0.02em | Page titles, Stat tile numbers |
| `--text-40` | 40 / 44 px | −0.03em | Hero numbers: ring centres, calories, steps, check-in score |

**Named styles.** Each is a utility class in `theme.css`.

| Class | Size | Weight | Colour |
|---|---|---|---|
| `.t-caption` | 12 | 400 | ink-tertiary |
| `.t-label` | 14 | 400 | ink-secondary |
| `.t-body` | 16 | 400 | ink |
| `.t-body-strong` | 16 | 600 | ink |
| `.t-title` | 20 | 600 | ink |
| `.t-page` | 28 | 700 | ink |
| `.t-stat` | 28 | 700 | ink, tabular |
| `.t-hero` | 40 | 700 | ink, tabular |
| `.t-tab` | 12 | 600 | ink-tertiary (active: ink) |

**Mapping from today.** 8–11.5 px → 12. 12–13.5 px → 14 for text people read, 12 for meta. 14–15 px → 16 for body and 14 for secondary. 16–18 px → 16 for body and 20 for titles. 20–24 px → 20. 26–36 px → 28. 40 px and up (including the 46 px readiness number, the 48 px check-in slider value and the 96 px check-in score) → 40. Weights 300 and 500 → 400 (or 600 for buttons and tabs); 650 → 600; 750 and 800 → 700.

**Numbers.** `font-variant-numeric: tabular-nums` on every element with `.t-stat` or `.t-hero`, on Set row inputs, chips with times or dates, chart labels, and anything that counts up.

### 4.3 Spacing

| Token | Value | Typical use |
|---|---|---|
| `--space-1` | 4 px | Icon to text in chips, segmented track padding |
| `--space-2` | 8 px | Between label and number, list row gap, gaps in Set rows |
| `--space-3` | 12 px | List row vertical padding, gap between cards on phone |
| `--space-4` | 16 px | Card padding on phone, page gutter on phone, section gaps |
| `--space-5` | 24 px | Card padding on desktop, gap between sections |
| `--space-6` | 32 px | Page gutter on desktop, space above section titles |

### 4.4 Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 8 px | Inputs inside Set rows, small chips inside rows, checkbox, video frame corners in lists |
| `--radius-md` | 12 px | Set rows, text inputs, photo thumbnails, tooltip |
| `--radius-lg` | 16 px | List rows, inner tiles, Banner, popover |
| `--radius-xl` | 24 px | Cards, sheets (top corners on phone), dialogs |
| `--radius-full` | 999 px | Buttons, segmented control, chips, pills, FAB, avatars, ring caps, heat cells, progress bars |

Mapping from today: 2–9 px → 8 (bars and dots → full); 10–13 px → 12; 14–18 px → 16; 20–28 px → 24; 44 and 999 px → full.

### 4.5 Elevation

One shadow per element. Never combined with a border.

| Token | Value | Use |
|---|---|---|
| `--elev-0` | `none` | Default for everything not listed |
| `--elev-1` | `0 2px 8px rgba(17, 17, 19, 0.04)` | Cards on canvas, selected segment, streak pill |
| `--elev-2` | `0 8px 24px rgba(17, 17, 19, 0.08)` | FAB, popover, toast, rest timer pill, chart tooltip |
| `--elev-3` | `0 16px 48px rgba(17, 17, 19, 0.12)` | Dialogs on desktop, sheets |
| `--elev-nav` | `0 -2px 12px rgba(17, 17, 19, 0.06)` | Bottom nav and sticky footers (shadow points up) |

### 4.6 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120 ms | Press, hover, checkbox, toggle, set done, colour changes |
| `--dur-base` | 200 ms | Segmented thumb, collapse and expand, scrim fade, toast in and out, page cross-fade, progress bar width |
| `--dur-slow` | 300 ms | Sheet slide, ring fill, count-up |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | Every transition and animation |
| `--press-scale` | `0.97` | `transform` on `:active` for buttons, rows, tiles, tabs, FAB |

Rules:

- Tab switches (Training tabs, Diary / Nutrients, Exercises / Muscles, Add exercise Machines / Exercises) swap content with no transition. Only the segmented thumb moves (200 ms).
- Count-up runs once per page load for hero and stat numbers (ring centres, calories, steps, "x of y" on the plan card). It starts at 0, lasts 300 ms, and the final value is in the DOM from the start (`aria-label` or visually hidden text), so screen readers and tests read the real value. It never runs again when the logger re-renders.
- No animation sets `pointer-events: none` or disables a control. A sheet accepts taps while it slides in. A tap during a count-up jumps it to the end.
- `@media (prefers-reduced-motion: reduce)`: every duration becomes 0 ms, `--press-scale` becomes 1, count-ups and ring fills are skipped, and the page cross-fade is off (as today).

### 4.7 Layout

| Token | Value |
|---|---|
| Breakpoint `md` | 768 px. Below it: bottom nav, back link, no sidebar (unchanged from today). |
| Breakpoint `lg` | 1024 px. Logger side panel moves beside the log (today 921 px). |
| `--layout-gutter` | 16 px below `md`, 32 px from `md` |
| `--layout-sidebar` | 240 px |
| `--layout-content-max` | 1040 px (dashboard and most pages), 1120 px (Training) |
| `--layout-nav-h` | 64 px + `env(safe-area-inset-bottom)` |
| `--layout-fab` | 56 px |
| `--layout-topbar` | 56 px (sheets, wizard, check-in) |
| `--layout-bottom-clear` | `calc(64px + 16px + env(safe-area-inset-bottom))`, page bottom padding below `md` |
| Z-index | nav 120 (as today), rest timer 130, sheet and scrim 200, toast 300 |

### 4.8 Icons

- **One set:** Lucide geometry (ISC licence), inline SVG, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.75"`, round caps and joins. The paths live in one module, `js/icons.js`, which every page and UI module uses. Today each page carries its own hand-copied SVGs with strokes from 1.5 to 2.2.
- **Sizes:** 16 px (inline with 12–14 px text), 20 px (buttons, list rows, inputs), 24 px (bottom nav, FAB, page header actions). The FAB plus is drawn at 28 px so it looks heavier without a second stroke width.
- **Colour:** `currentColor`; inherits `--color-ink`, `--color-ink-tertiary`, `--color-on-ink` or a meaning colour.
- **Tinted circle:** where an icon stands beside a number (Steps, Water, metrics), it sits in a 40 px (or 32 px in tiles) circle of `--color-surface-muted`.
- **Glyph map:** Home `house`, Train `dumbbell`, Food `utensils` (today a send-arrow), More `ellipsis`, Recovery `heart-pulse`, Habits `zap`, Sleep `moon`, Connections `link`, Exercises `list`, Progress `trending-up`, Consistency `calendar`, Finance `dollar-sign`, Settings `settings`, plus `plus`, done `check`, close `x`, back `chevron-left`, chevrons `chevron-right` / `chevron-down`, remove set `minus`, delete `trash-2`, duplicate `copy`, move `arrow-up` / `arrow-down`, search `search`, camera `camera`, barcode `scan-barcode`, voice `mic`, send `arrow-up`, notifications `bell`, check-in `sun`, streak `flame`, start `play`, rest timer `timer`, plates `disc`, steps `footprints`, water `droplet`, warning `triangle-alert`, info `info`.

### 4.9 Legacy aliases

Phase 1 points the old per-page names at the new tokens so every page changes at once. They are removed in the clean-up phase once no file uses them.

| Old | New | Note |
|---|---|---|
| `--bg` | `--color-canvas` | |
| `--s1`, `--s2` | `--color-surface-muted` | were 3% and 5% ink overlays |
| `--s3`, `--s4` | `--color-surface-pressed` | |
| `--bd`, `--bd2`, `--gm` | `--color-line` | borders are removed per component in phases 3–7 |
| `--t1` / `--t2` / `--t3` | `--color-ink` / `-secondary` / `-tertiary` | |
| `--gr` | `--color-success-ink` | used for text as well as fills, so the text-safe value |
| `--grd` | `--color-success-tint` | |
| `--lime`, `--lime2`, `--vi` | `--color-ink` | accents become ink |
| `--vid` | `--color-surface-muted` | |
| `--ye`, `--or`, `--orf` | `--color-warning` | |
| `--yed`, `--ord` | `--color-warning-tint` | |
| `--re` | `--color-danger-ink` | |
| `--red` | `--color-danger-tint` | |
| `--r`, `--r-lg` | `--radius-xl` | |
| `--r-sm` | `--radius-lg` | |
| `--sh0`, `--sh1` | `--elev-1` | |
| `--sh2` | `--elev-2` | |

Phase 1 also lists every other custom property declared in page `<style>` blocks (`grep -oh -- '--[a-z0-9-]*:' *.html | sort -u`) and maps or retires each one.

### 4.10 Dark mode

Not in this project. Every token is named for its role, not its colour, so a `@media (prefers-color-scheme: dark)` block can redefine them later without touching components.

---

## 5. Component library

Every component lives in a new shared stylesheet, `css/components.css`, loaded after `theme.css` on every page. Class names use a `ui-` prefix so they can sit beside the old classes during migration. Each spec lists anatomy, sizes, tokens, states and the inventory items that use it.

Universal states:

- **Pressed:** `transform: scale(var(--press-scale))`, `--dur-fast`, plus the background change listed per component.
- **Focus (keyboard only):** `outline: 2px solid var(--color-ink); outline-offset: 2px` via `:focus-visible`.
- **Disabled:** background `--color-surface-muted`, text `--color-ink-disabled`, no shadow, no press scale, `aria-disabled="true"` or `disabled`.

### 5.1 Card

- Background `--color-surface`, radius `--radius-xl`, shadow `--elev-1`, no border.
- Padding 16 px below `md`, 24 px from `md`.
- Anatomy, top to bottom: header row (optional) → label (`.t-label`) → number (`.t-hero` or `.t-stat`, with unit in `.t-label` on the same baseline, 4 px gap) → supporting line (`.t-caption` or `.t-label`) → action (Primary, Secondary or Text button), each separated by 8 px; 16 px above the action.
- Header row: title `.t-title` left; Text button or Icon button right; min height 44 px.
- **Hero variant** (D-09, T-03, T-04, T-06, T-07): same tokens; the only card on screen allowed a Primary L button.
- **Collapsible variant** (dashboard cards, D-21): header row is a button with `aria-expanded`; 20 px `chevron-down` on the right turns 180° in `--dur-base`; summary text (`.sec-sum`) shows in `.t-label` beside the title when collapsed; the body opens and closes in `--dur-base` (height and opacity). Open state still saved in `arete_dash_open`.
- **Muted variant** (inside sheets and the wizard): background `--color-surface-muted`, radius `--radius-lg`, padding 12 px, no shadow.
- Gap between cards: 12 px below `md`, 16 px from `md`.

### 5.2 Stat tile

- **On canvas:** background `--color-surface`, radius `--radius-xl`, padding 16 px, `--elev-1`.
- **Inside a card:** background `--color-surface-muted`, radius `--radius-lg`, padding 12 px, no shadow.
- **Compact (inline):** no background, no padding; used in rows of 2–4.
- Anatomy: label `.t-caption` → 4 px → value `.t-stat` (compact: 20 px bold) with unit `.t-label` → optional supporting line `.t-caption`.
- Optional 32 px icon circle (`--color-surface-muted`) top-left with a 16 px icon.
- Grid: 2 columns below `md`, 4 from `md`, 8 px gap inside cards, 12 px on canvas.
- Empty value: "–" in `--color-ink-tertiary`, never 0 unless the value really is 0.
- Used by D-08, D-09, D-11, D-16, D-19, T-15, T-25, C-05, P-02, P-09, R-02, S-02, S-05, ST-03, H-02, N-11, N-12.

### 5.3 Progress ring and gauge

| Size | Diameter | Stroke | Centre content |
|---|---|---|---|
| L | 160 px (120 px below 360 px width) | 12 px | `.t-hero` number + `.t-caption` label, or a 40 px tinted circle with a 24 px icon |
| M | 96 px | 8 px | `.t-stat` number, or a 32 px tinted circle with a 20 px icon |
| S | 56 px | 6 px | 20 px bold number, or a 16 px icon |

- Track `--color-line`; progress `--color-ink`; `stroke-linecap: round`; starts at 12 o'clock and runs clockwise.
- No gradient (the readiness ring's `#34D27E → #1DA462` gradient goes).
- Values over 100% draw a full ring; the number shows the real value.
- On page load the arc fills from 0 in `--dur-slow` together with the count-up. No animation on later updates other than a `--dur-base` transition of `stroke-dashoffset`.
- `role="img"` with `aria-label`, for example "Readiness 74 of 100" or "3 of 4 sessions done this week".
- **Gauge** (Energy Intelligence, D-19): same tokens, 270° sweep from 7:30 to 4:30, 96 px, 8 px stroke; number `.t-stat`; label "Energy" `.t-caption`.
- Used by D-09 (L), D-17 (L), N-04 (L), T-04 (S), S-03 (M), D-19 (gauge).

### 5.4 Week strip

- Seven equal columns, Monday first (as today). Each column: weekday letter `.t-caption` → 4 px → 36 px circle. Tap target is the whole 44 × 56 px column when the strip is interactive; the plan card strip is display only (as today).
- States (from `planHome.js`: `done`, `missed`, `planned`, `rest`, plus today):

| State | Circle | Inside | Letter |
|---|---|---|---|
| Done | 2 px `--color-success` ring, `--color-success-tint` fill | 16 px `check`, `--color-success-ink` | ink-tertiary |
| Missed | 2 px `--color-danger` ring, no fill | 16 px `minus`, `--color-danger-ink` | ink-tertiary |
| Planned (future) | 2 px `--color-ink-tertiary` ring | empty | ink-tertiary |
| Today, planned, not done | 2 px `--color-ink` dashed ring (dash 4, gap 3) | empty | `--color-ink`, 600 |
| Today, done | Done style | check | `--color-ink`, 600 |
| Rest | no ring | 4 px `--color-line` dot | ink-tertiary |

- Each column keeps its `aria-label` (for example "Tuesday: Upper, done").
- Below the strip: "**3 of 4** this week · 75%" in `.t-label`, the count in `--color-ink` 600, tabular.
- **Preview variant** (plan wizard W-05 "Week after", `tw-strip`): no done or missed states; training days show the workout abbreviation (12 px semibold) inside a 36 px `--color-surface-muted` circle; rest days show the 4 px dot.
- Used by T-04, W-05, W-11.

### 5.5 Streak pill

- Height 32 px, padding 0 12 px, radius full, background `--color-surface`, `--elev-1`.
- 16 px `flame` icon in `--color-warning`, 4 px gap, value in 14 px bold tabular `--color-ink` ("6 days").
- Not a button today; it stays a static element (no press state).
- Used by D-06.

### 5.6 Segmented control

- Track: background `--color-surface-muted`, radius full, padding 4 px, height 40 px (small: 32 px).
- Segments: equal width, radius full, `.t-body-strong` at 14 px (small: 12 px), `--color-ink-secondary`.
- Selected segment: background `--color-surface`, `--elev-1`, text `--color-ink`. The white thumb slides between segments in `--dur-base`; the content below swaps with no transition.
- Same weight (600) in both states so labels never shift.
- `role="tablist"` / `role="tab"` / `aria-selected` where it switches views (as the Add exercise sheet already does); `role="radiogroup"` where it sets a value (chronotype, cue type, Servings / Grams, rotation).
- Tap targets: the track is 40 px tall; each segment gets a 44 px hit area by extending 2 px above and below.
- Used by T-02 (4 segments), T-29, D-08, D-19, C-02, R-04, N-06, N-12, E-02, H-06, W-05, L-03, L-06.

### 5.7 Bottom nav (≤767 px)

- Full width, fixed to the bottom, height `--layout-nav-h`, background `--color-surface`, shadow `--elev-nav`, no border, no blur, no inset pill.
- Four tabs in today's order: Home, Train, Food, More. They share the width left of the FAB (screen width − 88 px).
- Tab: 24 px icon above a `.t-tab` label, 4 px gap; inactive `--color-ink-tertiary`, active `--color-ink`. No active background, no indicator bar.
- Each tab fills its column (at least 44 × 56 px).
- More opens the existing sheet (G-05) as a Sheet (§5.12).
- Pressed: `--press-scale`. Navigation still happens on tap, as today.
- Replaces the floating white pill in `js/mobilenav.js` (left/right 12 px inset, radius 26 px, shadow `0 8px 26px rgba(23,32,14,.18)`).

### 5.8 FAB

- 56 px circle, background `--color-ink`, 28 px `plus` icon in `--color-on-ink`, `--elev-2`. No lime ring.
- Position: right 16 px, bottom `calc(4px + env(safe-area-inset-bottom))`. That places it inside the bottom nav's 64 px band, at the right end, so it never covers scrolling content.
- Pressed: background `--color-ink-pressed` + `--press-scale`.
- Same link as today: `workouts.html?start=today`. `aria-label="Start today's workout"`.
- Phone only, as today.

### 5.9 List row

- Min height 56 px; padding 12 px 16 px; radius `--radius-lg`; 8 px gap between rows.
- Background: `--color-surface-muted` inside a card; `--color-surface` (with `--elev-1`) directly on canvas.
- Anatomy, left to right: optional leading 40 px icon circle or thumbnail (radius `--radius-md`) → text column (title `.t-body-strong`, subtitle `.t-label`, both one line with ellipsis unless the content needs two) → trailing slot.
- Trailing options: time or date chip (height 24 px, padding 0 8 px, radius full, background `--color-surface` inside cards or `--color-surface-muted` on canvas, `.t-caption` 600 tabular `--color-ink-secondary`), status chip (same shape; Done = `--color-success-tint` + `--color-success-ink`; Missed = `--color-danger-tint` + `--color-danger-ink`; Today = `--color-ink` + `--color-on-ink`), 20 px `chevron-right` in `--color-ink-tertiary`, a value (`.t-body-strong` tabular), a Checkbox, or a Text button.
- Pressed (when tappable): background `--color-surface-pressed` + `--press-scale` at 0.99 (rows are wide, so a smaller scale).
- Dividers: none. Rows are separate tiles.
- **Dense variant** (tables of exercises, plan rows in sheets): min height 48 px, padding 8 px 12 px.
- **Selectable variant** (W-03 split cards, SE-02 readiness source): trailing 24 px circle; unselected 2 px `--color-ink-tertiary` ring; selected `--color-ink` fill with a 16 px white `check`; the row gets a 2 px `--color-ink` outline (`outline-offset: -2px`). `aria-pressed` or `role="radio"` as today.

### 5.10 Set row (logger)

Grid, left to right:

| Column | Width | Content |
|---|---|---|
| Set tag | 32 px | Working set number or "W"; 14 px semibold tabular; `--color-ink-secondary` (W in `--color-ink-tertiary`). Tapping toggles warm-up, as today. |
| kg | 1fr | Number input |
| Reps | 1fr | Number input |
| RIR | 48 px | Number input |
| Done | 44 px | Done toggle |
| Remove | 44 px | 20 px `minus` icon button, `--color-ink-tertiary` |

- Row: height 48 px; gap 4 px; padding 4 px; radius `--radius-md`; background `--color-surface-muted`; 8 px between rows.
- Inputs: height 40 px, background `--color-surface`, radius `--radius-sm`, no border, centred 16 px bold tabular `--color-ink`; placeholders (last time's weight, target reps, target RIR) in `--color-ink-tertiary` 400.
- Done toggle, visual 32 px circle in a 44 px target: pending is a 2 px `--color-ink-tertiary` ring; done is a `--color-success` fill with a 16 px white `check`. Changing state takes `--dur-fast` and happens in the same frame as the tap (the write to `jarvis_active_workout` is already synchronous). No confirmation.
- Done row: background `--color-success-tint`; inputs stay editable.
- PR: done style plus a 2 px `--color-success` ring 2 px outside the circle; tooltip and `aria-label` "Personal record".
- Header row above the sets: Set, kg, Reps, RIR, Done in `.t-caption`, sentence case (today uppercase 10 px).
- Width check at 360 px: gutter 16 × 2 + card padding 12 × 2 leaves 304 px, which gives kg and reps 58 px each, enough for "102.5" at 16 px bold.
- "Add set": Text button with a 16 px plus icon, full width, height 44 px.

### 5.11 Charts

**Line chart** (T-28 weight progression; P-07 when expanded; the Cal AI progress chart):

- One series: 2 px `--color-ink` line, round joins, no fill under the line, no point markers except the selected one.
- Grid: horizontal lines only, 1 px `--color-line`, `stroke-dasharray: 2 4`, 4 lines. No vertical grid lines, no axis lines.
- Axis labels: `.t-caption` tabular, `--color-ink-tertiary`; y-axis labels right-aligned in a 40 px gutter; x-axis labels below, at most 5.
- Selected point: 8 px `--color-ink` dot with a 2 px `--color-surface` ring.
- Tooltip: background `--color-ink`, radius `--radius-md`, padding 8 px 12 px, `--elev-2`; value 16 px bold tabular `--color-on-ink` ("68.2 kg"); date `.t-caption` `--color-on-ink-secondary` ("21 Oct 2024"). Placed 8 px above the point and kept inside the chart. Appears on tap or hover, fades in `--dur-fast`.
- Height: 200 px below `md`, 240 px from `md`.
- Range control (where one exists today): Segmented control (small) above the chart. Ranges are not added where there are none.

**Multi-series** (D-19 energy forecast): three lines distinguished by style: combined forecast 2 px solid `--color-ink`; the two component curves 1.5 px `--color-ink-tertiary`, one dashed (4 4) and one dotted (1 4). Legend uses the same line samples (16 × 2 px) beside `.t-caption` labels. The violet, blue and orange curve colours go.

**Bar chart** (P-05 volume, S-04 nights, ST-03 steps): bars `--color-ink` (current period) and `--color-line` (others, or empty days); bar width 12–16 px; radius full; 4 px gap minimum; same grid and labels as the line chart. Sleep quality dots: 6 px `--color-ink` circles above each bar.

**Sparkline** (D-09, D-16, P-07): 40 px tall, 2 px `--color-ink` line, no grid, no labels, last point a 6 px dot. Labelled by a `.t-caption` above it.

**Empty chart:** keep the axes; draw no line; centred `.t-label` with the page's existing empty copy.

### 5.12 Sheet, dialog and full-screen sheet

**Sheet (below `md`):**

- Anchored to the bottom, full width, radius `--radius-xl` on the top corners, background `--color-surface`, `--elev-3`, max height 92vh, padding-bottom `env(safe-area-inset-bottom)`.
- Grab handle: 36 × 4 px, radius full, `--color-line`, 8 px from the top, centred (decoration only; tapping the scrim or Close dismisses).
- Header: 56 px; title `.t-title` left; 44 px Close icon button right.
- Body: padding 0 16 px 16 px, scrolls on its own (`overscroll-behavior: contain`, as today).
- Footer (when a sheet has actions): sticky, padding 12 px 16px plus the safe area, background `--color-surface`, `--elev-nav`; Primary on the right, Secondary or Text to its left; on phones they share the width 1 : 2.
- Enter: slides up 24 px and fades in over `--dur-slow`; scrim fades in over `--dur-base`. Exit: `--dur-base`. The sheet takes taps immediately.

**Dialog (from `md`):** the same content centred, width 560 px for forms and 640 px for lists (Add exercise, catalogue, machine details), radius `--radius-xl` on all corners, `--elev-3`, max height 88vh.

**Full-screen sheet (W-01 to W-12, D-22):** covers the viewport, background `--color-canvas`; 56 px top bar (Close left, title centre `.t-body-strong`, step count right `.t-label` tabular); content column max 560 px centred, padding 16 px (24 px from `md`); sticky footer as above.

**All three:** scrim `--color-scrim`; focus moves into the sheet on open and back to the trigger on close; Escape closes; `role="dialog"` with `aria-modal="true"` and `aria-labelledby` the title. Today's open and close functions (`openEx`, `closeFood`, `closeLog` and the rest) keep their names and behaviour.

### 5.13 Banner

- Radius `--radius-lg`, padding 12 px 16 px, 20 px leading icon, text `.t-label` (first phrase may be 600).
- Kinds: success (`--color-success-tint` + `--color-success-ink`, `check` icon), warning (`--color-warning-tint` + `--color-warning-ink`, `triangle-alert`), error (`--color-danger-tint` + `--color-danger-ink`, `triangle-alert`), info (`--color-surface-muted` + `--color-ink-secondary`, `info`).
- At most one success Banner per screen. On Progress it carries the encouragement line (P-03); on Habits the perfect-day line (H-04).
- Used for validation and network errors, the wizard warning (W-11), login messages (L-02, L-09), step tracking status (ST-04), the sleep suggestion (CH-04).

### 5.14 Toast

- Background `--color-ink`, text `.t-label` in `--color-on-ink`, radius `--radius-lg`, padding 12 px 16 px, `--elev-2`, max width 360 px, centred.
- Position: `--layout-bottom-clear` + 8 px from the bottom on phones (above the nav); 32 px from the bottom on desktop. When the rest timer pill is showing, 8 px above it.
- Enter: fade + 8 px rise over `--dur-base`. On-screen time unchanged from today. `role="status"`.
- Never blocks taps on what is under it except its own box.

### 5.15 Empty state

- Inside the card or area that is empty, never a separate page.
- 48 px `--color-surface-muted` circle with a 24 px icon in `--color-ink-tertiary` → 12 px → title `.t-body-strong` → 4 px → body `.t-label`, max 2 lines, centred, max width 280 px → 16 px → optional Secondary button.
- Copy is today's copy ("No tasks yet — add one above.", "No exercises yet", "No sleep logged yet.", "No quests yet.", "Your skill sheet is empty.", "Tap a square to see that day.", "Log your first workout and your week shows up here.", "Coming soon").
- Stat tiles with no data show "–", not 0 (§5.2).

### 5.16 Loading, error and offline states

**Loading: skeletons, never spinners.**

- Blocks of `--color-surface-muted` in the exact shapes of the content they replace (row height 56 px, text bars 12 px tall with radius full at 60% and 40% widths, ring as a 12 px `--color-line` circle).
- No shimmer; the blocks are static, which keeps motion within the three duration tokens.
- The busy region gets `aria-busy="true"`; today's loading text stays in the DOM as visually hidden text ("Loading the machine database…", "Loading muscle database…", "Calculating…", "Analysing your photo…", "Starting camera…").
- Where today's loading text is the only feedback (consistency "Loading…", Energy "Calculating…"), the skeleton replaces the visible text.
- Buttons that start a slow action keep today's busy label and get `aria-busy`; no spinner icon inside them.

**Error:** error Banner (§5.13) inside the card that failed, today's message, and today's retry action if one exists ("Scan again", "Retake").

**Offline:** the app has no offline indicator today. Network-dependent actions (food search, barcode lookup, AI photo, video import, provider sync, login) already show their own error messages; those messages use the error Banner. A global offline banner would be a new feature (OS-05).

### 5.17 Inputs

| Type | Spec |
|---|---|
| Text input | Height 48 px; padding 0 16 px; radius `--radius-md`; background `--color-surface-muted`; no border; `.t-body`; placeholder `--color-ink-tertiary`. Label above in `.t-label`, 8 px gap. Focus: 2 px `--color-ink` outline, no offset. Error: 2 px `--color-danger` outline and a `.t-caption` `--color-danger-ink` message 4 px below, linked with `aria-describedby`. |
| Multi-line | Same; min height 96 px; padding 12 px 16 px. The Arete input (D-20) grows with content as today. |
| Number input | Text input with `inputmode` as today and tabular figures. Unit shown as a `.t-label` suffix inside the field. |
| Select | Text input look; 20 px `chevron-down` at the right in `--color-ink-tertiary`; native picker kept. |
| Search field | Text input with a 20 px `search` icon at 16 px from the left (text starts at 44 px). Clear button only where one exists today. |
| Stepper | 44 px round Icon buttons (`minus`, `plus`) in `--color-surface-muted` either side of a `.t-stat` value (water, food quantity). |
| Slider | 4 px `--color-line` track, `--color-ink` fill, 28 px white thumb with `--elev-1`; value shown above in `.t-hero`. Native `<input type="range">` styled. |
| Checkbox | 24 px circle: 2 px `--color-ink-tertiary` ring; checked `--color-ink` fill (or `--color-success` where it means done: tasks, quests, habits) with a 16 px white `check`; 44 px hit area. |
| Chip | Height 32 px; padding 0 12 px; radius full; background `--color-surface-muted`; `.t-label` `--color-ink`. Selected: `--color-ink` background, `--color-on-ink` text. Used for prompt chips (D-20), muscle tags (D-11), food categories (N-10), "My exercises" (E-04). |
| Day toggle (wizard) | 7 equal columns with no gap; each whole column (at least 46 × 56 px at 360 px) is the tap target. Inside it, a 40 × 56 px visual tile, radius `--radius-lg`: off `--color-surface-muted` with a `--color-ink-secondary` letter; on `--color-ink` with `--color-on-ink`. |

### 5.18 Heat grid

- Cells are circles (radius full), 12 px with 3 px gaps below `md`; 14 px with 4 px gaps from `md`. The grid scrolls sideways as today.
- Fill by level: empty `--color-line`; levels 1–4 `--color-heat-1` to `--color-heat-4` (the plan-aware level rules in `features/training/services/consistency.js` are unchanged).
- Today: 2 px `--color-ink` ring around the cell. Planned future days (the "Planned" key): 1.5 px `--color-ink-tertiary` ring, no fill.
- Month labels `.t-caption`; legend "Less ○○○○○ More" in `.t-caption` with 10 px dots.
- Tapping a cell selects it with a 2 px `--color-ink` ring and fills the Day detail card (C-07), as today. Cells keep their `aria-label`s.

### 5.19 Body map

- The body images stay. Muscle patches use the recovery ramp (§4.1.4) at 0.85 fill opacity; "No data" patches use `--color-line`.
- Legend: 8 px dots + `.t-caption` labels in one wrapping row, 12 px gap.
- Selected patch: 2 px `--color-ink` stroke.
- Logger diagram: Primary `--color-ink` at 0.85, Secondary at 0.35.

### 5.20 Buttons

| Kind | Background | Text | Pressed |
|---|---|---|---|
| Primary | `--color-ink` | `--color-on-ink` | `--color-ink-pressed` |
| Secondary | `--color-surface-muted` | `--color-ink` | `--color-surface-pressed` |
| Text | none | `--color-ink` (600) | `--color-surface-muted` background |
| Destructive | `--color-danger-tint` | `--color-danger-ink` | `--color-danger-tint` + scale |
| Destructive text | none | `--color-danger-ink` | `--color-danger-tint` background |
| Icon | none or `--color-surface-muted` | `--color-ink` icon | `--color-surface-pressed` |

| Size | Height | Padding | Text | Icon |
|---|---|---|---|---|
| L | 52 px | 0 24 px | 16 px / 600 | 20 px |
| M | 44 px | 0 20 px | 16 px / 600 | 20 px |
| S | 36 px (44 px hit area) | 0 16 px | 14 px / 600 | 16 px |
| Icon | 44 × 44 px | — | — | 20 or 24 px |

- Radius full for all. No shadow, no gradient, no border.
- Icon and label gap 8 px; icon on the left.
- Full width on phones inside sheets, the wizard footer and hero cards.
- Disabled: universal disabled state. Loading: today's busy label, `aria-busy="true"`.
- Replaces `.btn-p`, `.btn-gr` (ink with `0 8px 18px -6px` shadow), `.btn-s`, `.btn-c`, `.btn-d`, `.tw-btn`, `.tw-btn2`, `.lg-link`, `.icon-btn`, `.ib`, `.water-btn`, `.x-btn`.

### 5.21 Page header

- Below `md`: back link row (§5.22), then title `.t-page`, then subtitle `.t-label` with 4 px gap; actions (for example "Log sleep", "New habit", "Scan / Goals") sit right of the title as S buttons, or wrap below on narrow screens.
- From `md`: same, 32 px top padding, no back link.
- Dashboard header (D-01 to D-07): greeting `.t-label` → sub-line `.t-title` on the left; check-in, notifications, streak pill, avatar on the right, 8 px apart.

### 5.22 Back link

- 44 px tall row: 20 px `chevron-left` + "Dashboard" `.t-label` 600 in `--color-ink-secondary`; no background, no blur.
- Sticks to the top below the safe area (as today) on `--color-canvas`.

### 5.23 Sidebar (from `md`)

- Width 240 px, background `--color-surface`, no border (the page canvas next to it gives the edge).
- Logo row 64 px: 32 px ink square with radius `--radius-md` and the white Arete mark, "Arete" `.t-body-strong`.
- Group labels ("Main", "Life") `.t-caption`, 24 px above, 8 px below.
- Links: height 40 px, padding 0 12 px, radius `--radius-md`, 20 px icon, `.t-label` 600 `--color-ink-secondary`. Active: `--color-surface-muted` background, `--color-ink`. Pressed: `--color-surface-pressed`.
- Footer: 36 px avatar, name `.t-body-strong`, plan `.t-caption`.

### 5.24 Popover

- Background `--color-surface`, radius `--radius-lg`, padding 16 px, `--elev-2`, width 260 px; title `.t-body-strong`; rows `.t-label` label left and `.t-body-strong` tabular value right, 8 px apart; Progress bar for Recovery %.
- Desktop only, as today (phones use the Sheet).

### 5.25 Progress bar

- Height 8 px (4 px for the logger's line under the top bar and for macro rows inside list rows), radius full, track `--color-line`, fill `--color-ink`.
- Over 100%: fill stays full; the number shows the real value. Today's over-limit marking keeps its meaning and stays red: "N over" calories (`nutrition.html:1331`) and nutrients past their limit (`nutrition.html:1442`) use `--color-danger-ink` text on `--color-danger-tint`.
- Width changes in `--dur-base`.
- Replaces lime bars and the per-macro colours (lime, orange, amber, `#38BDF8`).

---

## 6. Screen specs

Mobile first. Phone layouts are measured at 390 × 844 px and must also work at 360 px and 430 px. Desktop is 1280 × 900 px. Section order on every screen stays exactly as it is today; only the look of each block changes.

### 6.0 Rules for every page

- Canvas `--color-canvas`; gutter 16 px below `md`, 32 px from `md`; content max width 1040 px (Training 1120 px), centred in the space right of the sidebar.
- Top padding below `md`: `env(safe-area-inset-top)` + 8 px, then the back link (44 px), then 8 px, then the page header. Bottom padding below `md`: `--layout-bottom-clear`.
- Gap between cards 12 px below `md`, 16 px from `md`. Section titles outside cards (for example "Other ways to train", "Weekly completion"): `.t-label` 600 `--color-ink-secondary`, 24 px above, 8 px below.
- Desktop multi-column rows that exist today keep their columns (dashboard Workout + Tasks; Nutrition + Sleep + Steps; logger + side panel), with 16 px gaps.
- Everything inherits `font-family: var(--font-sans)` and `color: var(--color-ink)` from `body`.

### 6.1 Dashboard (`index.html`), detailed

**6.1.1 Header (D-01 to D-07).**

- Phone: a two-row grid. Row 1: greeting `.t-label` on the left (up to 2 lines); on the right, 8 px apart and in today's order: check-in Icon button (24 px `sun`, 8 px `--color-danger` dot at its top-right when a check-in is pending), notifications Icon button (24 px `bell`, same dot rule), Streak pill, 36 px avatar. Row 2 spans both columns: the sub-line in `.t-title` (20 px semibold; today it is larger and wraps to five lines at 390 px). The date (D-03) keeps today's visibility rule and, where shown, sits under the greeting in `.t-label`.
- Desktop: one row. Left: greeting `.t-label`, sub-line `.t-title` below it. Right: date (two lines, `.t-label`), then the same four controls.
- No gradient on the avatar; no tinted buttons.

**6.1.2 Consistency card (D-08).**

- Card. Header row: Segmented control (small, "Training" / "Code") left, "See all" Text button with a 16 px `chevron-right` right.
- Headline `.t-body-strong` 12 px below. Heat grid (§5.18) 12 px below, with month labels above it.
- Stats row 16 px below the grid: four compact Stat tiles in one row (2 × 2 below 360 px): This week, Active days (30d), Workouts 2026, Last workout. Values 20 px bold tabular; labels `.t-caption`.

**6.1.3 Daily readiness (D-09).**

- Hero card.
- Phone: Ring L centred (160 px, 12 px stroke, ink on `--color-line`), number `.t-hero` (count-up on load), "Ready" `.t-caption` below the number. Then 16 px, eyebrow "Daily readiness" `.t-label`, 4 px, copy `.t-body` (the first sentence keeps its bold, 600). Then a 4-column row of compact Stat tiles: Sleep, Energy, Mood, Sleepiness (label `.t-caption`, value 20 px bold; "–" until a check-in; the coloured underline dashes go). Then "Start today's plan" Primary L, full width, with a 20 px `play` icon, and below it "Adjust plan" Secondary M, full width. Sparkline "Readiness this week" at the bottom (40 px tall), label `.t-caption`.
- Desktop: three columns: ring (160 px) | text, metrics and buttons (buttons side by side, Primary M + Secondary M) | sparkline (200 px wide). The green left border goes.
- The ring is ink. Readiness is not coloured by score, because no state meaning is defined for it today.

**6.1.4 Explore grid (D-10, phone only).** Card titled "Explore" (`.t-label` 600). 4 × 2 grid of tiles, 8 px gap; each tile is a 48 px `--color-surface-muted` circle with a 24 px ink icon, 8 px above a `.t-caption` label in `--color-ink`; whole tile is the link (min 72 × 80 px), pressed `--press-scale`. All eight per-item tints are removed.

**6.1.5 Collapsible cards (D-11 to D-16, D-19).** Each uses the Collapsible card. Closed: one 56 px row with title `.t-label` 600 left, summary `.t-label` tabular right (for example "6 ready · 2 recovering", "0 / 2,650 kcal", "6h 52m · score 78"), chevron. Open:

- *Today's Workout (D-11):* name `.t-title`; four compact Stat tiles (Program, Exercises, Sets, ~Time); muscle Chips (wrap, 8 px gap); "Full plan" Text button; start Primary M. Empty ("No plan yet"): Empty state with today's copy and "Create a plan" Primary M; the green tinted box goes.
- *Tasks (D-12):* Progress bar (8 px); 12 px; Text input "Add a task…" with "Add" Primary S on its right (8 px gap); task List rows (Checkbox left meaning done, title, delete Icon button right with `trash-2`); empty text as Empty state (text only, no icon, because the input sits right above it).
- *Today's Focus (D-13):* the "Habits" link becomes a Text button with `chevron-right` in the header; habit List rows with Checkbox; empty "No quests yet" + "Add your first habit" Text button.
- *Muscle Recovery (D-14):* Body map front and back side by side (each 50% width, max 200 px), legend row below, stat line `.t-label`. Tapping a muscle opens the Popover (desktop) or Sheet (phone) with Recovery % (Progress bar) and the four rows. "Full report" Text button with `chevron-right`.
- *Nutrition (D-15):* "0" `.t-hero` + "/ 2,650 kcal" `.t-label` on one baseline, "%" `.t-caption`; four rows (Protein, Carbs, Fats, Water): label `.t-label` left, "0 / 180 g" `.t-label` tabular right, 4 px Progress bar below, 12 px between rows; all bars ink. "Log meal" Primary M (flex 1) + camera Icon button (44 px, `--color-surface-muted`).
- *Sleep (D-16):* two Stat tiles "Score" and "Total" (score in `--color-ink`; the amber colouring goes because 78 has no defined state); three compact tiles Bed, Wake, Consist.; Sparkline; insight `.t-label`. Values stay the static ones (§2.19).
- *Energy Intelligence (D-19):* header row adds the chronotype Segmented control (small, 3 segments) right of the title, as today. Body: Gauge (96 px) left with status heading `.t-body-strong` and sub `.t-label` right; forecast chart (Line chart, 3 line styles, 64 px tall, legend above right); explainer `.t-caption`; 2 × 2 Stat tiles (Peak energy, Best focus, Workout window, Dip / rest); footer row: confidence `.t-caption` left, "Log energy" Text button right.

**6.1.6 Steps (D-17, D-18).** Card shaped like the Cal AI steps card: left column "0" `.t-hero` with "/ 10,000" `.t-label` on its baseline, "Steps today" `.t-label` below, remaining `.t-caption`; right column Ring M with a 20 px `footprints` icon in a 32 px tinted circle at its centre. Below: two compact Stat tiles (7-day average, Current streak), explainer `.t-caption`, "History" Secondary M full width. The permission panel (D-18) is a Card: title `.t-title`, two paragraphs `.t-label`, "Enable step tracking" Primary L full width (today a green button, which becomes ink).

**6.1.7 Arete input (D-20).** Card. Label "Arete" `.t-label` 600 with the Arete mark 16 px. Multi-line input (min 48 px, grows). Voice and Send Icon buttons inside the field at the bottom right (Send is a 36 px ink circle with a 20 px white `arrow-up`; today it is green). Prompt Chips below, wrapping, 8 px gap.

**6.1.8 Morning check-in (D-22).** Full-screen sheet on `--color-canvas`.

- The animated glowing orb (radial gradients, particles, hue cycling at `index.html:2633`) becomes a static 96 px `--color-surface` circle with `--elev-1` and a 40 px Arete mark in ink. In the thinking phase the existing status text keeps changing at today's pace; nothing spins or pulses.
- Headings `.t-page` (today 30–34 px light weight); body `.t-label`; section labels such as "Work / school days" `.t-label` 600 (no uppercase); time inputs are Text inputs on `--color-surface`, 2 columns, 12 px gap.
- Question phase: question `.t-title`; slider (§5.17) with its value in `.t-hero` (today 48 px light); progress as a 4 px Progress bar under the top bar with "2 of 5" `.t-label` tabular.
- Results: score `.t-hero` inside a Ring L (today 96 px light text); label and date `.t-label`; summary `.t-body`; strengths as List rows with a `check` icon in `--color-success`; recommendation in a Card (muted).
- Continue / Next: Primary L, full width, in the sticky footer.

**6.1.9 Legacy bottom bar (G-06).** Restyled with the Bottom nav tokens and set to exactly `--layout-nav-h` so it sits fully under the shared nav. Decision D-1 (§10.1) settles whether it stays.

### 6.2 Training logger (`workouts.html`, active workout), detailed

**6.2.1 Layout.** Phone: one column. From `lg` (1024 px): log column (1fr) + side panel (320 px), 16 px gap, side panel sticky at 16 px from the top. Page header hidden during a workout (as today, `.pg.in-workout .ph`).

**6.2.2 Top bar (T-18).** Sticky at `top: env(safe-area-inset-top)`; full-bleed on phones (spans the gutter), inside the card on desktop; background `--color-surface`; padding 12 px 16 px.

- Left: workout name input `.t-title`, transparent background, `--color-surface-muted` background on focus, radius `--radius-md`, single line with ellipsis. Below it: "**4** of 14 sets done" `.t-caption`, the count in 600 `--color-ink`, tabular.
- Right: "Finish" Primary M (44 px). It stays in the top bar as today (OS-08 covers moving it into the thumb zone).
- Bottom edge: 4 px Progress bar, full width, `--color-line` track, ink fill; width transitions in `--dur-base` as sets are ticked.
- When the page scrolls, the bar gets `--elev-1` to separate it from the content.

**6.2.3 Exercise card (T-19).** Card with 12 px padding below 400 px width, 16 px above.

- Header row (min 44 px): exercise name as a Text button `.t-body-strong` (tapping opens weight progression, as today) on the left; plate calculator and remove Icon buttons (20 px `disc` and `x`, 44 px targets) on the right.
- Meta line 4 px below: "Target **4 × 8 · 2 RIR**" and "Last time **80 × 8, 80 × 7** · 12 Oct" in `.t-caption`, values 600 `--color-ink-secondary`, separated by 12 px; wraps.
- Machine block (when a machine is chosen): List row (dense, muted) with the 40 px machine icon circle, "Brand · Model" title, resistance profile subtitle, chevron; same actions as today.
- Set header row then Set rows (§5.10), 8 px apart. "Add set" Text button below.
- 12 px between exercise cards.

**6.2.4 Below the exercises (T-21 to T-24).** "Add exercise" Secondary L, full width, with a 20 px plus icon. Notes: "Add a note" Text button, which opens a multi-line input (min 96 px). Then three Text buttons in a row (wrapping on narrow screens): "Save as routine", "Save for later", "Discard workout" (Destructive text). Empty state (T-21) replaces the exercise list when there are no exercises: `dumbbell` icon, "No exercises yet", "Add your first one to start logging sets."

**6.2.5 Rest timer (T-26).** Pill: height 44 px, padding 0 16 px, radius full, `--color-ink` background, 20 px `timer` icon + time in 16 px bold tabular `--color-on-ink`, `--elev-2`. Phone: centred, 16 px above the bottom nav. Desktop: bottom right, 32 px from the edges. Its existing controls keep their positions inside the pill and become 44 px icon buttons.

**6.2.6 Side panel (T-25).** Card "Muscles worked": `.t-title`, Body map (ink at 85% and 35%), legend, targets as Chips, note `.t-caption`. Card "This session": four List rows (dense, muted): label `.t-label`, value `.t-body-strong` tabular.

**6.2.7 Sheets from the logger.** Add exercise (T-29): Sheet / 640 px Dialog; Segmented "Machines" / "Exercises" under the header; Search field; two Selects side by side (Muscle group, Brand), 8 px gap; count `.t-caption`; machine List rows (dense): title `.t-body-strong`, type `.t-caption`, resistance-profile Chip and muscle action `.t-label` (two lines max), info Icon button right; combo and cable-station choices open as a muted strip under the row with Secondary S buttons or a Select + "Add" Primary S. Plate calculator, weight progression (Line chart with tooltip, §5.11) and machine details are Sheets with the standard header.

**6.2.8 Speed.** Opening the logger from the FAB or "Start workout" shows the logger in the first paint (no intermediate screen, as today). Ticking a set, typing a value or adding a set updates in the same frame. Count-ups never run in the logger, because it re-renders on every change.

### 6.3 Plan wizard (`planWizard.js`), detailed

**6.3.1 Frame (W-01, W-02, W-12).** Full-screen sheet. Top bar 56 px: Close Icon button left, "New training plan" or "Edit plan" `.t-body-strong` centred, "1 of 4" `.t-label` tabular right. Under it, a 16 px-padded row of four segments (each flex 1, 4 px tall, radius full, 4 px gap): done and current `--color-ink`, later `--color-line`; under each segment its label ("Split", "Days", "Workouts", "Review") in `.t-caption` (current in `--color-ink` 600). Each segment and label is one button with a 44 px tall hit area; disabled beyond the furthest step reached, as today. Footer: error Banner (when present) above the buttons; "Back" Secondary L (flex 1, `chevron-left` icon) and "Continue" / "Start training plan" / "Save plan" Primary L (flex 2). Step 1 has no Back (an empty spacer keeps Continue on the right, as today). Continue stays disabled until a split is chosen.

**6.3.2 Content column.** Max 560 px, centred; heading `.t-page` ("Choose your split"); helper text `.t-label` 8 px below; 24 px before the first control; field labels `.t-label` 600 with 8 px below; 24 px between groups.

**6.3.3 Step 1, split (W-03, W-04).** Eight selectable List rows on `--color-surface` with `--elev-1`, 8 px apart, min height 72 px: name `.t-body-strong`, blurb `.t-label` ("4 days a week"), selection circle right (§5.9). Custom Split selected: a muted Card appears below the list: "Split name" Text input; "Workouts" label; one Text input per workout with a remove Icon button (`x`) beside it when there is more than one; "Add workout" Text button with a plus icon.

**6.3.4 Step 2, days (W-05 to W-07).**

- Weekly splits: heading; seven day toggles (§5.17) in a row (at 360 px each column is 46 px wide and fully tappable); "Recommended for Upper / Lower" as a success-tinted Chip, or "Use recommended: Mon Tue Thu Fri" as a Text button; "Each new week" label + Segmented control (Continue the rotation / Restart at <first workout>); "First week" label + seven dense List rows (weekday `.t-label` 600 40 px wide, date `.t-caption`, workout `.t-body-strong` or "Rest" in `--color-ink-tertiary`); "Week after" label + Week strip (preview variant).
- Every other day: heading and explainer; "First training day" date input; "Your next five weeks": a 7-column calendar of 36 px circles: training days `--color-ink` fill with white date, rest days `--color-ink-secondary` date on no fill, today with a 2 px ink ring, days before the start in `--color-ink-disabled`. Each cell keeps its label and tooltip.
- Custom split: one dense List row per chosen day, with the day name left and a Select of workouts right.

**6.3.5 Step 3, workouts (W-08 to W-10).** One disclosure Card per workout (radius `--radius-xl`, `--elev-1`). Header row 56 px: name `.t-body-strong`, meta `.t-caption` ("5 exercises · 16 sets"), chevron. A workout that is scheduled but empty shows a 16 px `triangle-alert` in `--color-warning` before the meta and "No exercises yet" in `--color-warning-ink`. Open body: "Workout name" input; exercise items as muted Cards (radius `--radius-lg`, 12 px padding, 8 px apart):

- Top line: number in a 24 px `--color-surface` circle (`.t-caption` 600), name `.t-body-strong`, then four Icon buttons (`arrow-up`, `arrow-down`, `copy`, `trash-2`) at 36 px visual with 44 px hit areas; up is disabled on the first item and down on the last, as today.
- Fields line: Sets, Reps (min "–" max), RIR as small Number inputs (height 40 px, `--color-surface`, radius `--radius-sm`), each with a `.t-caption` label above.
- Machine line: chosen machine as a dense List row with a "Remove machine" Text button; otherwise "Choose machine" Text button with a plus icon and "12 in the database for this exercise" `.t-caption`.

Under the items: "Add exercise" and "Use starter template" Secondary S buttons; "Remove <workout>" Destructive text button. Below all workouts: "Add another Full Body workout" Text button with a plus icon and the rotation note `.t-caption`.

**6.3.6 Step 4, review (W-11, W-13).** Summary as four compact Stat tiles in a 2 × 2 grid (Split, Frequency, Starts, New weeks) with 16 px values (text, not numbers). "Schedule" label row with an "Edit" Text button right; the first week rows and Week strip as in step 2 (or the 8-row list for every other day). "Workouts" label row with "Edit"; one muted Card per workout listing exercises as dense rows: name `.t-body-strong`, machine `.t-caption`, "4 × 8–10 · 2 RIR" `.t-label` tabular right. "Overlap & coverage" label; the overlap panel as a muted Card: coverage rows with 4 px Progress bars, overlap notes with warning icons, Chips for muscle groups. Warning (when a step has an issue): warning Banner with the message and a "Fix" Text button. Editing only: "End this plan" Destructive text button at the bottom; after the first tap its label changes to "Tap again to end this plan" (as today) and it becomes a Destructive button.

### 6.4 Other screens

| Screen | Phone layout (390 px) | Desktop changes |
|---|---|---|
| Training, Today (T-03 to T-10) | Segmented tabs under the header. Resume / plan / program hero Card first: eyebrow `.t-label` in sentence case ("Today · Push / Pull / Legs"; the green uppercase goes), title `.t-page`, date `.t-label`, exercise rows as dense List rows with "4 × 8" tabular right, Primary L "Start workout" full width. Plan card (T-04): eyebrow + "Edit plan" Text button; title and sub; exercise rows; Primary L; then a row with Ring S ("3 of 4" inside) and "3 of 4 this week · 75%" `.t-label` beside it, and the Week strip full width below (seven 36 px circles fit in the 296 px left at 360 px); upcoming sessions as List rows with a date chip and a "Start" Text button. Setup card (T-08): `.t-title`, `.t-label`, Secondary M "Set up plan". "Other ways to train" section title + List rows with 40 px icon circles. Scheduled: List rows with date chips. | Two columns from `lg`: hero + plan card left (1fr), other ways + scheduled right (360 px). |
| Training, Plan (T-11 to T-14) | Plan overview Card: eyebrow, `.t-title` plan name, "Upper / Lower · 4 days a week · **2 of 4** done this week" `.t-label`, "Edit plan" Secondary S. "This week": seven dense List rows (day + date left, workout centre, status chip or "Start" Text button right). "Workouts in this plan": disclosure rows. Programs: Cards with List rows; example note as an info Banner. Catalogue: Sheet with List rows + Checkbox and a sticky footer showing the count and "Add" Primary L. Coaching: Card with a disclosure row. | Overview and programs side by side from `lg`. |
| Training, History (T-15, T-16) | Stat tiles 2 × 2; session List rows (title, "5 exercises · 18 sets" subtitle, date chip); tapping opens the session Sheet with its own Stat tiles, exercise rows and "Repeat" Primary L. Physique: Card with a 3-column photo grid (radius `--radius-md`, 4 px gap) and its existing actions. | Stats in one row of 4. |
| Training, Machines (T-17) | Search field, filter Selects (2 per row), count `.t-caption`, machine List rows as in the Add exercise sheet; details Sheet. | Rows in a 2-column grid. |
| Consistency (C-01 to C-07) | Header; Segmented control; year row (two 44 px Icon buttons around the year `.t-title` tabular); Heat grid Card with updated time and legend `.t-caption`; Stat tiles 2 × 2; "Weekly completion" List rows (week label, "3 of 4" tabular, 4 px Progress bar); Day detail Card (Empty state until a cell is tapped). | Stats 1 × 4. |
| Progress (P-01 to P-09) | Stat tiles 2 × 2 (P-02). Recap Card: "Your week" `.t-title`, items as `.t-body` lines 8 px apart with bold kept, the streak line as the success Banner where it appears today, "Share" Secondary M. Heat grid Card. Volume Bar chart Card. PRs: List rows (lift, "100 kg × 5" tabular, date chip). Strength: List rows with a Sparkline right. Muscle balance: List rows with Progress bars. Life: Stat tiles. | Two columns from `md` for the lower cards. |
| Recovery (R-01 to R-07) | Header with "Log workout" Secondary S; summary Stat tiles; Card with legend, Segmented Front / Back, Body map; "All muscles" List rows (muscle, state chip using the ramp colour as a 8 px dot, 4 px Progress bar). | Map and list side by side. |
| Nutrition (N-01 to N-15) | Header actions "Scan" Primary S, "Goals" Secondary S. Day navigation row: two Icon buttons around the day label `.t-body-strong` with the date `.t-caption`. Calorie Card: Ring L with "Eaten" number `.t-hero` inside and "of 2,650" `.t-caption`; beside it "2,650 left" `.t-title` (or "N over" in danger colours). Macro rows (Protein, Carbs, Fat) with Progress bars and values. Segmented Diary / Nutrients. Water Card like Cal AI: `droplet` in a 40 px tinted circle, "0.0 / 3.0 L" `.t-stat`, Progress bar, Stepper buttons right. Meals: one Card each; header row with meal name `.t-title`, kcal tabular and an add Icon button; entries as List rows (name, serving `.t-caption`, kcal right). Nutrients view: Cards with List rows and Progress bars. Food Sheet screens follow §5.12; result rows show name, serving and kcal; the scanner frame is 16 px-radius video with a 2 px white guide rectangle. | Calorie Card and Water side by side; meals in 2 columns. |
| Sleep (S-01 to S-07) | "Log sleep" Primary S in the header. Last night Card: hours `.t-hero` + "h" unit, meta `.t-label`, three compact tiles. Alertness Card: Ring M + heading `.t-body-strong` + `.t-label`. Last 7 nights Bar chart Card. Stat tiles 2 × 2. History List rows (date chip, duration, quality). Log Sheet with date and time inputs, Slider, "Duration: 8h 0m" `.t-label`, footer. | Charts and stats side by side. |
| Steps (ST-01 to ST-04) | Goal row: label + Number input with "steps" suffix. History Card: Bar chart, Stat tiles (Weekly average, Best day, Goal-completion days, Current streak, This month). Permission Card as on the dashboard. "Step tracking is on" as a success Banner. | — |
| Habits (H-01 to H-07) | Hero Card: "Character" `.t-label`, "Lv 3" `.t-hero` (the "Lv" prefix `.t-label`), XP line `.t-label` tabular, 8 px Progress bar to the next level, two compact tiles (skills, perfect days). "Today's quests" title with the count Chip; quest List rows with a Checkbox (success when done) and "+20 XP" `.t-label` tabular right (success-ink when done). Perfect-day success Banner. "Skills" List rows: name, "1,240 XP · 60 to Adept" `.t-caption`, combo value right, 4 px Progress bar. New habit Sheet. | Quests and skills side by side. |
| Exercises (E-01 to E-05) | Segmented Exercises / Muscles. Muscles: intro `.t-label`, Search field, two Selects, count, muscle List rows (region `.t-body-strong`, action `.t-label`, resistance-profile Chip), update notes Card. Exercises: info Banner (the "ready" notice), Search, two Selects, "My exercises" Chip, count, then the table rendered as dense List rows on phones (name, category · equipment `.t-caption`, source chip). Add / edit Sheet. | The table keeps its 6 columns: header `.t-caption` 600, rows 48 px, 1 px `--color-line` dividers, no outer border. |
| Connections (CN-01 to CN-05) | Explainer Card (`.t-title` "Connect once, sync forever.", body `.t-label` with bold kept). Connected Health as a List row with chevron. Provider List rows on canvas: 40 px logo circle, name, status Chip (Connected = success tint; Coming soon = muted), action Text or Secondary S button right; expanded metrics (Live HR, HRV, Resting HR, Last activity) as compact Stat tiles. Oura Sheet with numbered steps as `.t-label` lines, token input, error text, footer. | Provider rows in 2 columns. |
| Connected Health (CH-01 to CH-04) | Intro `.t-label`; link as Text button; sources as List rows with status chips; Source preferences as List rows with Selects; "Import history from" Select; "Sync now" Secondary M; permission dialog as Sheet; sleep suggestion as info Banner with two Text buttons. | — |
| Settings (SE-01 to SE-05) | "Daily readiness source": four selectable List rows (title + subtitle). "AI features": Card with `.t-label` explainer, password Text input, "Save key" Primary S + "Remove" Text button, status `.t-caption`, link Text button. "Account": Card with "Signed in" `.t-label` and email `.t-body-strong`, "Sign out" Destructive text. "More settings coming soon" `.t-caption` centred. | Max width 640 px. |
| Login (L-01 to L-09) | Centred column, max 400 px, on `--color-canvas`. 48 px ink logo square, title `.t-page`, sub `.t-label`. Segmented Create account / Sign in. Three Secondary L social buttons with brand marks, 8 px apart. "Or with email" `.t-caption` between 1 px `--color-line` rules. Segmented (small) Email / Phone. Inputs with labels; hint `.t-caption`; Primary L submit; "Forgot password?" Text button. Message area as a Banner. Legal line `.t-caption`. | Same column inside a white Card (padding 32 px) centred on the canvas. |
| Finance, Goals (F-01, GO-01) | Header + Empty state with "Coming soon" and the back link as a Secondary M button. | — |

---

## 7. Accessibility

| Area | Requirement |
|---|---|
| Contrast | Body and label text ≥ 4.5:1, large text (≥ 20 px semibold or ≥ 24 px) ≥ 3:1, icons and control boundaries ≥ 3:1. The token pairs in §4.1 meet this; `--color-ink-tertiary` is never placed on `--color-surface-pressed`; `--color-success` and `--color-warning` are never used for text under 20 px (use the `-ink` tokens). |
| Colour is never alone | Week strip states also differ by icon (check, minus, dashed ring); status chips carry words; heat cells and body-map patches keep their `aria-label`s and the tap-for-detail behaviour; over-limit nutrition values also say "over". |
| Targets | Every tap target is at least 44 × 44 px, including Set row buttons, wizard reorder buttons, chips and the segmented control. Adjacent targets don't overlap. |
| Focus | `:focus-visible` ring (2 px ink, 2 px offset) on every control; never removed (36 `outline: none` declarations exist today and are audited in each phase). Sheets trap focus and return it on close. |
| Screen readers | Rings and gauges have `role="img"` and an `aria-label` with the value; count-ups expose the final value from the start; segmented controls use tab or radio roles; toasts use `role="status"`; busy regions use `aria-busy`; icon-only buttons keep or gain an `aria-label` (Set row, wizard, header). |
| Text size | Sizes in `rem` (16 px root) so browser text settings apply; layouts hold at 200% text size without horizontal page scroll (the heat grid and tables keep their own horizontal scroll). |
| Motion | `prefers-reduced-motion` as in §4.6. |
| Zoom | 18 pages set `maximum-scale=1.0, user-scalable=no` today, which blocks pinch zoom (WCAG 1.4.4). Changing that is a behaviour change, so it is decision D-2 (§10.1); the recommendation is to allow zoom. |
| Thumb zone | Below `md`, the FAB, bottom nav, sheet footers and the wizard footer sit in the bottom 120 px. The logger's Finish button stays at the top (OS-08). |

---

## 8. Rollout

Each phase is one pull request that can ship on its own. Each one bumps `VERSION` in `sw.js`, runs `npm run build:web`, and passes the verification in §8.2 before merging.

### 8.1 Phases

| Phase | Scope | Main files |
|---|---|---|
| 0. Baseline | Scripted screenshots of every inventory item at 390 × 844 and 1280 × 900 with fixed fixture data (empty user; user with a plan, three finished workouts and an active workout). Record the `localStorage` keys written during the §8.4 flow run. Write the audit script (§8.3). No product changes. | `docs/redesign/baseline/`, `scripts/` (dev only, not shipped) |
| 1. Tokens | Rewrite `css/theme.css`: §4 tokens, legacy aliases (§4.9), base `body` styles, type utilities, focus ring; self-host Inter; update the press and transition values in `css/touch.css`. Every page changes colour, type and radius at once; no markup changes. | `css/theme.css`, `css/touch.css`, `fonts/`, `sw.js` |
| 2. Components | Add `css/components.css` (§5) and `js/icons.js` (§4.8). Restyle the bottom nav, FAB and More sheet in `js/mobilenav.js`. Add a component gallery for review at `docs/redesign/components.html` (not shipped). | `css/components.css`, `js/icons.js`, `js/mobilenav.js` |
| 3. Training | Logger, Today, Plan, History, Machines tabs, all Training sheets, plan wizard, overlap panel, machine UI (T-01 to T-34, W-01 to W-13). | `workouts.html`, `css/training.css`, `css/machines.css`, `features/training/ui/*`, `features/machines/ui/*`, `features/exercises/ui/*` |
| 4. Dashboard | D-01 to D-23 and decision D-1. | `index.html`, `features/steps/components/*` |
| 5. Tracking | Nutrition, Sleep, Steps, Recovery, Habits. | `nutrition.html`, `sleep.html`, `steps.html`, `recovery.html`, `habits.html` |
| 6. Insight | Progress, Consistency, Exercises. | `analytics.html`, `consistency.html`, `exercises.html` |
| 7. Account and setup | Settings, Connections, Connected Health, Login, Finance, Goals. | the six pages, `features/health/ui/*`, `js/wearables.js` (markup strings only) |
| 8. Clean-up | Remove legacy aliases and unused per-page tokens and classes, the Google Fonts links, and the leftover inline colours; run the audit over the whole repo. | all pages |

### 8.2 Verification for every phase

1. **Unit tests:** all suites pass with the same counts as on 16 October 2026: `npm run test:exercises` (20), `test:machines` (30), `test:training` (34), `test:muscles` (9), `test:steps` (21), `test:health` (27): 141 in total. `npm run typecheck` passes.
2. **Generators:** `node scripts/build-machine-db.mjs --check` and `node scripts/build-muscle-db.mjs --check` report no drift.
3. **Storage:** after the §8.4 flow run, the sorted list of `localStorage` keys equals the Phase 0 list, and the stored JSON for a scripted workout, plan and food entry is byte-identical.
4. **Screenshots:** the phase's screens are captured at 390 × 844, 360 × 800, 430 × 932 and 1280 × 900 with the Phase 0 fixtures, placed beside the baseline, and reviewed against the §6 spec. Every inventory item for the phase must be visible and reachable in the new shot.
5. **Console:** no page errors in the headless run (Chrome via `puppeteer-core`, as in earlier checks).
6. **Audit:** §8.3 reports zero violations in the files the phase changed.
7. **Manual flows:** every §8.4 flow touching the phase passes on a phone (iOS Safari or the Capacitor build) and in desktop Chrome.

### 8.3 Audit script

A dev-only Node script (`scripts/audit-design.mjs`, not copied to `www`) that fails on, outside `css/theme.css`:

- hex, `rgb()`, `rgba()`, `hsl()` colours (allow-list: brand marks in `login.html`, provider logos);
- `font-size` not in {12, 14, 16, 20, 28, 40} px or a `--text-*` token;
- `font-weight` not in {400, 600, 700};
- `border-radius` not in {8, 12, 16, 24, 999 px, 50%} or a `--radius-*` token;
- `box-shadow` that is not an `--elev-*` token;
- `linear-gradient`, `radial-gradient`, `conic-gradient`, `backdrop-filter`;
- transition or animation durations not 120, 200 or 300 ms or a `--dur-*` token;
- `font-family` declarations;
- emoji and the glyphs ✕ ✓ ⚠ ＋ used as icons.

It prints file, line and value, and runs per phase on changed files and in phase 8 on everything.

### 8.4 Manual flow checklist

| # | Flow | Pass when |
|---|---|---|
| F1 | Sign up and sign in (email) | Lands on the dashboard; the account shows in Settings. |
| F2 | Morning check-in from the header | All phases render; the score shows on the readiness ring; `jarvis_checkin` is written. |
| F3 | Create an Upper / Lower plan in the wizard (4 days, 2 workouts, one exercise with a machine) | Plan card shows on Today with the right week strip; `jarvis_training_plan` is written. |
| F4 | Start today's workout from the FAB | Logger opens in one tap with the planned exercises. |
| F5 | Log three sets (type weight and reps, tick done), toggle a warm-up, add a set, remove a set | Each change shows in the same frame; "x of y sets done" and the progress line update. |
| F6 | Add an exercise from the Machines tab of the Add exercise sheet (single, combo, cable station) | Each is added with its machine. |
| F7 | Finish the workout | Toast "Logged · …"; the week strip day turns done; the heat map cell fills; Recovery shows the muscles as recovering. |
| F8 | Save as routine, save for later and resume, discard | Same outcomes as today. |
| F9 | History: open a session, Repeat | A new workout starts with the same exercises. |
| F10 | Nutrition: search and add a food, change portion, add water, edit goals, scan a barcode (manual number) | Totals, rings and bars update; `jarvis_nutrition_log` is written. |
| F11 | Sleep: log a night | Last night and the 7-night chart update. |
| F12 | Habits: create a habit, complete a quest | XP, level and the perfect-day line behave as today. |
| F13 | Consistency: switch Training / Code, change year, tap a cell | Day detail fills. |
| F14 | Recovery: tap a muscle (desktop and phone) | Popover / Sheet shows the five values. |
| F15 | Exercises: add a custom exercise; Muscles view filters | Appears in the list and in the Add exercise sheet. |
| F16 | Settings: change readiness source; save and remove the AI key; sign out | Same as today. |
| F17 | Connections: open the Oura sheet, cancel | Same as today. |
| F18 | Bottom nav: each tab, More sheet, every link | Each opens the right page; the active tab is ink. |
| F19 | Keyboard only (desktop): complete F3 and F5 | Every control reachable with a visible focus ring. |
| F20 | Reduced motion on: F4, F5, open and close a Sheet | No movement; everything works. |

---

## 9. Acceptance criteria by phase

| Phase | Done when |
|---|---|
| 0 | Baseline screenshots exist for every inventory ID at the four sizes and both fixture states; the key list and storage snapshots are saved; the audit script runs and its current violation count is recorded. |
| 1 | `theme.css` defines every token in §4 with the exact values listed; every page renders Inter (self-hosted, works offline after one visit); canvas is `#F5F5F7` and cards `#FFFFFF` on all 16 pages; no lime, sage or violet is visible in the baseline screenshots; press scale is 0.97 at 120 ms; §8.2 passes. |
| 2 | Every §5 component appears in the gallery in all its states and sizes at 390 px and 1280 px; the bottom nav is a full-width 64 px bar with four tabs and an ink FAB at bottom right linking to `workouts.html?start=today`; all icons come from `js/icons.js`; §8.2 passes. |
| 3 | All T and W items are ticked in §2; the logger meets §6.2 (Set row grid fits at 360 px without horizontal scroll, 44 px targets, same-frame set ticking); the wizard meets §6.3; F3–F9 pass; the audit is clean for every Training file; §8.2 passes. |
| 4 | All D items are ticked; header, readiness, collapsible cards and the check-in match §6.1; decision D-1 is applied; F2 and F18 pass; §8.2 passes. |
| 5 | All N, S, ST, R and H items are ticked; F10–F12 and F14 pass; §8.2 passes. |
| 6 | All P, C and E items are ticked; exactly one success Banner shows on Progress, only when today's streak line shows; F13 and F15 pass; §8.2 passes. |
| 7 | All SE, CN, CH, L, F and GO items are ticked; F1, F16 and F17 pass; §8.2 passes. |
| 8 | The audit reports zero violations across the repo; no legacy alias or Google Fonts link remains; every §2 checkbox is ticked; the anti-vibe checklist (§3.2) passes on every page; F1–F20 pass. |

---

## 10. Out of scope and ideas for later

### 10.1 Decisions needed before the phase that touches them

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D-1 | The dashboard has a second bottom bar (G-06) under the shared nav at ≤767 px. Its only unique item, "Arete", focuses the input on the same page. | (a) Keep it, restyled, hidden under the shared bar (the default in this PRD). (b) Remove it (a feature removal). | (b), as a separate change after Phase 4. |
| D-2 | Pinch zoom is disabled on 18 pages (`user-scalable=no`). | (a) Keep. (b) Allow zoom (WCAG 1.4.4). | (b). |

### 10.2 Ideas that need feature or behaviour changes

| ID | Idea | Why it is out of scope |
|---|---|---|
| OS-01 | Wire the static dashboard values (greeting name and time, date, streak "6 days", readiness copy and sparkline, the sleep card) to real data, and show "–" for readiness before the first check-in instead of 82. | Changes what the screen shows. Highest-value follow-up: the "no fake numbers" rule can't fully pass until it's done. |
| OS-02 | Stop seeding three sample workouts for new users (`seedMockData()`), or label them as samples. | Changes first-run data and behaviour. |
| OS-03 | Give "Adjust plan" and the notifications button an action, or remove them. | Both are controls without behaviour today. |
| OS-04 | Dark mode. | New user-visible mode. Tokens are ready for it (§4.10). |
| OS-05 | A global offline banner. | New state and behaviour. |
| OS-06 | A 3-tab bar like Cal AI (Home / Progress / Settings). | Restructures navigation. This PRD keeps four tabs. |
| OS-07 | One sidebar menu for all pages. | Today's menus differ per page; unifying them adds and removes links. |
| OS-08 | Move the logger's Finish button into the thumb zone (sticky bottom bar). | Moves a control and changes the logger's structure. |
| OS-09 | A week strip in the dashboard header, as in Cal AI. | Adds a component to a screen that has none. |
| OS-10 | Haptic feedback on set done and finish (Capacitor). | New behaviour. |
| OS-11 | Swipe to delete set rows and list rows. | New interaction. |
| OS-12 | A range control (90 days, 6 months, 1 year, all time) on weight progression and Progress charts. | New feature. |
| OS-13 | Count-ups on numbers that change while you watch (calories after adding food). | New behaviour beyond the first load. |
| OS-14 | Remove or merge the "Coming soon" Finance and Goals pages. | Removes screens. |
| OS-15 | Make the streak pill tappable (open Consistency). | New behaviour. |
| OS-16 | Restyle `muscle-editor.html` and `sandbox.html`. | Internal tools, not in the product. |
