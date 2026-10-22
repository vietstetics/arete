# Arete Coach — powerlifting coaching workflow (coach subscription)

## Goal
Replace the messy "clients send videos over Discord" workflow with one
organised place. Coaches import a program from a spreadsheet, clients train
with Arete's camera (rep counting, rep-1 standardised ROM, velocity chart),
and every set's video and data lands in the coach's view, organised by
client → week → day → exercise → set. Powerlifting coaches first.

Build inside the existing Arete app. Reuse what exists: the plan/program
system (features/training), the workout logger (workouts.html), the camera
rep counter + velocity engine (curl-lab.html, features/standard), the
Coaching tab, and the velocity plan in docs/velocity-tracking-plan.md.
Don't break existing features.

## 1. Accounts and roles (needs a real backend)
- Turn on Supabase accounts (env vars already exist on Vercel; js/auth.js has
  the CFG hook). Two roles: Coach and Client.
- Coach invites a client by link or code; the client accepts and is linked.
- Row-level security: a coach sees only their own clients; a client sees
  only their own data.
- Coach subscription (paid); clients use the app free when linked to a coach.

## 2. Coach imports a spreadsheet → program
- Coach uploads .xlsx or .csv (parse in the browser with SheetJS).
- Support common powerlifting layouts: Week, Day, Exercise, Sets, Reps,
  Load (kg) or % of 1RM, RPE or RIR, Rest, Notes. Multiple weeks/blocks.
- Column-mapping screen: Arete guesses the columns, the coach confirms or
  fixes them. Never guess silently.
- Percentages convert to kg from the client's maxes (coach enters squat,
  bench, deadlift 1RMs per client), rounded to the nearest 2.5 kg.
- Preview the full program (weeks → days → exercises → sets) before
  publishing. Flag anything unreadable instead of dropping it.
- Publish to one or more clients with a start date.

## 3. Client trains with the camera
- The published program appears in the client's Train tab as today's session.
- Each set shows the prescription (e.g. 3 × 5 @ 140 kg, RPE 8).
- Tap Record: the camera counts reps, locks the standard on rep 1, marks
  short reps (count zero), and records the velocity per rep.
- Client confirms load, enters RPE (and notes if they want).
- The video saves to the phone's camera roll AND uploads (compressed) to
  the coach. Upload in the background, retry on bad gym Wi-Fi, and show
  "uploaded ✓" per set.

## 4. Coach review (the core screen)
- Client list: name, last session date, sessions completed this week vs
  planned, and flags (missed session, RPE well above target, velocity drop,
  short reps). Sort by "needs review" first.
- Client → Weeks → Days → Exercises → Sets, all one tap deeper each level.
- Per set: the video (with the rep-counter overlay), reps counted vs
  prescribed, short reps and why, load, RPE prescribed vs actual, and the
  velocity bar chart (m/s per rep, velocity loss %).
- Per day: a compact summary table of every set (load, reps, RPE, top
  velocity, velocity loss) so the coach can scan without opening videos.
- Coach can comment on any set (client gets a notification) and mark a
  day "Reviewed".
- Velocity over time per lift: rep-1 speed at each load, and an estimated
  1RM trend.

## 4b. Set review player — TikTok-style (the coach's main screen)
When a coach taps a set (or a day), open a full-screen vertical feed:

**Layout (portrait, per set)**
- **Top 2/3: the set video**, autoplaying, muted by default, looping. Tap to
  pause/play, double-tap to replay the last rep, drag to scrub, 0.5× speed
  toggle for checking depth/lockout.
- **Bottom 1/3 (all remaining space): the velocity chart, LIVE** — synced to
  the video's playback time, not a static picture:
  • a bar appears for each rep at the moment that rep finishes in the video,
    labelled with its m/s; short reps appear as empty outlined slots with the
    reason; a playhead line moves across the chart in time with the video;
  • scrubbing the video moves the chart, and tapping a bar jumps the video
    to that rep;
  • after the last rep, the set's velocity loss % and the stop line show.
- **Top-right overlay: rep counter** that ticks up in sync with the video
  (counted reps big, short reps small underneath, e.g. "4" / "1 short").
- **Top-left overlay: the coach's prescription vs what happened**, compact:
  load (kg), reps prescribed → counted, RPE target → actual, set type
  (warm-up / top set / back-down / accessory), set number (e.g. "Top set 1/1").
- Overlays use small semi-transparent pills so they never hide the lift.

**Scrolling (swipe up/down = next/previous set)**
- One continuous feed per session, in training order: warm-ups → top sets →
  back-downs → accessories, then the next exercise. Set types come from the
  coach's spreadsheet (column or inferred from labels like "top set",
  "back-off", "warm-up"); if unknown, ask the coach to tag, never guess.
- Swipe left/right = jump to the previous/next exercise or day.
- A thin progress strip at the top shows where you are in the session
  (each segment = one set, coloured by status: reviewed / flagged / new).
- Preload the next two videos so swiping is instant; sets without video
  still appear (data + chart only, "no video" label).

**Coach actions on each set (right-edge buttons, like TikTok)**
- Comment (text or voice note; pinned to a timestamp in the video).
- Flag (e.g. "depth", "bar path", "RPE mismatch") — shows on the client's set.
- Mark reviewed (or auto-mark when the coach watches the whole set).
- Share a clip (exports the video with the overlay + chart for social or
  the client).

**Desktop**
- Same feed in a centred phone-width column; arrow keys to move between
  sets; the day's summary table in a side panel.

**Performance**
- Stream compressed video (720p, H.264/HEVC) with a thumbnail poster frame.
- Velocity data is tiny (per-rep times + m/s), stored with the set so the
  live chart needs no processing on the coach's device.

## 5. Design
- Clean, fast, Cal AI-style (the current theme). Coach screens must work
  on desktop as well as phone.
- No clutter: the coach should go from client list to a set's video in
  three taps.

## 6. Privacy
- Explicit consent before uploading video; client can delete any video.
- Videos visible only to the client and their coach.
- Storage: compress videos; keep them 90 days by default (coach can pin).

## 7. Build order (one phase at a time)
1. Supabase accounts, roles and coach–client linking.
2. Spreadsheet import with column mapping and preview → program.
3. Program delivery to the client's Train tab.
4. Camera recording per set, with video upload and set data saved.
5. Coach client list → week → day screens, and the TikTok-style set review player (section 4b).
6. Comments, "reviewed" status, notifications.
7. Velocity trends and estimated 1RM per lift.
8. Coach subscription billing.

## Testing
- Unit tests for the spreadsheet parser using real coach templates
  (percentages, RPE, multi-week).
- An end-to-end test: import → publish → client logs a recorded set → the
  coach sees it with video and velocity.
