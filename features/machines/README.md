# Strength-machine database

913 machines from `Strength_Machines_App_Database - Machines.csv`. Each machine is:

- matched to an exercise;
- has its recorded muscle action mapped onto the muscle-action list in `features/muscles`;
- is used on the Training page and by the plan wizard's overlap analysis.

Anything that can't be mapped cleanly is **flagged**, not guessed. `REVIEW.md` lists every flag.

## Files

| File | Role |
|---|---|
| `data/Strength_Machines_App_Database - Machines.csv` | The source, byte-for-byte as supplied (SHA-256 recorded in the generated module). |
| `data/machines.js` | **Generated.** One array per row, every cell verbatim, in file order. |
| `REVIEW.md` | **Generated.** Import counts, mapping summary, and every flag by machine. |
| `data/exercises.js` | Exercise taxonomy, hand-written: new machine exercises, movement families, station lists. |
| `services/source.js` | Strict CSV parsing (header, 9 columns, required fields) and stable ids. |
| `services/actions.js` | "Muscle action" text → modes and atomic actions, via an explicit phrase table. |
| `services/muscles.js` | Atomic actions → muscle-list entries (targets, unresolved regions, unlisted actions). |
| `services/profile.js` | "Resistance profile" text → category; source type → trust label. |
| `services/match.js` | Machine → exercise(s); stations; name/mode consistency flags. |
| `services/db.js` | Assembles everything, plus search, filters, per-exercise lookups and overlap records. |
| `ui/machineUI.js` | Picker, details sheet, Machines browser, and the chosen-machine block. |
| `index.js` | Browser entry: `window.Machines`, event `machines-ready`. |

```
npm run build:machines                   # regenerate data/machines.js and REVIEW.md
node scripts/build-machine-db.mjs --check
npm run test:machines
```

To update the data:
1. Replace the CSV with the new export, keeping the file name.
2. Run `npm run build:machines`.
3. Run the tests.

Wording the parser doesn't know (a new action phrase, profile or mode label) **throws**. The error names the text, so it can be added deliberately.

## Import

- All 913 rows are imported, verbatim and in order. A test compares every cell with the CSV.
- No row is an exact duplicate, and brand + line + machine + model is unique for every row.
- **Ids** are `brand-model`, e.g. `hammer-strength-il-row`. When the model is blank, or shared by more than one row, the machine name is appended. Ids are deterministic for a given file. Logged exercises keep a small snapshot (brand, name, model, profile, mode), so history still reads if the file changes later.
- Near-duplicates are **kept as separate machines and flagged**:
  - Two rows share model `VS-VFT`.
  - Three names repeat with different models.
  - Ten rows have no model.

## Muscles: derived, never invented

Only your muscle list's own wording is used. For each muscle-list entry:

- **Plane prefixes are dropped.** For example, "Sagittal plane shoulder extension" becomes shoulder extension. By definition, flexion and extension are sagittal-plane movements, ab- and adduction are frontal-plane, and horizontal movements are transverse-plane.
- **"with …" / "when …" are qualifiers** (context), e.g. "Knee flexion **when hip is flexed**".
- **"Shoulder flexion or abduction"** is met by either movement.

A machine's recorded action then gives:

| Result | Rule | Used for overlap / coverage |
|---|---|---|
| **Target** | An entry whose movement is that action, with no qualifier. | Yes |
| **Region not recorded** | Entries for that movement that need a qualifier the machine row doesn't state. Elbow flexion → Brachioradialis / Brachialis / Biceps brachii; plantar flexion → the four calf regions. | Listed, never scored. Coverage reports "cannot be determined". |
| **Compound part** | "Knee and hip extension" matches the list's own compound entry (Quadriceps — Squat pattern). The single-joint regions it touches are listed as unresolved, not assumed. | Listed only |
| **Conditional** | "hip extension may be added", "knee extension depending on technique". | Listed only |
| **Not in your muscle list** | Trunk, neck, wrist and grip actions; scapular elevation; shoulder rotation; ankle dorsiflexion. | Shown, not mapped |

The muscle-group filter uses target groups. It also uses a group when every unresolved region of an action belongs to that one group: "Elbow flexors" is certain even when the region isn't.

Consequences of the muscle list's wording, kept as is:

- "Sagittal plane shoulder extension" is listed for both Latissimus dorsi — Upper and Pectoralis major — Lower chest. So every row, pulldown and pullover also lists the lower chest, shown as "via shoulder extension".
- Lateral raises list Deltoid — Anterior as well as Middle, because the anterior entry reads "Shoulder flexion **or abduction**".
- Scapular elevation (shrugs) isn't mapped to Trapezius — Upper, whose action is "Pulls clavicle backwards".

## Resistance profiles

- The raw text is always shown.
- **Comparable categories:** Ascending, Descending, Bell-shaped, Constant.
- **Not comparable** (treated as "not specified" by overlap): Exercise-dependent, Adjustable (PRIME SmartStrength), Mode-dependent (Biodrive), Configuration-dependent, Selectable, Variable (unpublished cam).
- **Bell-shaped is kept separate** from the muscle list's MID-RANGE. The two files word them differently, and the equivalence hasn't been reviewed.
- The source type is shown with a short label: *Estimated*, *Manufacturer*, or *Retailer / supplier*. 648 rows say "Estimated mechanics; linked GENERAL source does not verify model".

## Exercises

1. Each recorded mode is matched **by its action first**. A row recording "shoulder adduction/extension and elbow flexion" is a pulldown.
2. **The name then picks the exercise** within that movement: seated, lying, kneeling or standing leg curl; decline or flat press; T-bar, high or cable row; and so on. See `services/match.js`.
3. **New exercises:** 27 machine movements had no exercise in the library, so they were added. Examples are Machine Row, Decline Machine Press, Hip Abduction Machine and Kneeling Leg Curl.
   - For the recovery body map, each borrows the muscle map of an existing library exercise (`like`).
   - Machine Hip Flexion uses the list's hip-flexion region instead.
   - Neck and rotator-cuff exercises have no body-map region, so they get none.
4. **Families** group variations of one movement. A pulldown machine is offered as "similar" for Neutral-Grip Lat Pulldown, and so on.
5. **Stations** are rows with no recorded action:
   - **Cable (73):** offered for the library's cable exercises.
   - **Smith (12):** offered for Smith Machine Squat and Low-Incline Smith Press, and as related machines for barbell lifts.
   - **Multi-station (22):** only a possible match, because which stations they include isn't recorded.
6. **Unmatched (9):** no action, and the name doesn't identify an exercise. They can still be found and added from the Machines tab; the exercise is then named after the machine.

## On the Training page

- **Add exercise:** an exercise with machines leads to the machine step (search, brand, "for this exercise" or all 913, last used first). Free-weight exercises are added directly.
- **Exercise card:** shows brand, model, profile, the recorded action (for the chosen mode) and the derived muscles. "Details" opens the full record, with source link and review notes; you can change or remove the machine there.
- **Machines tab:** search plus muscle-group, brand and exercise filters. "Add to workout" adds the machine to the open session.
- **Carried through:** the machine travels with routines, Repeat, scheduled plan sessions, Programs days and history.
- **Last time:** prefers the same machine. Another machine's loads are labelled and aren't offered as placeholders.
- **Plan wizard:** each row can carry a machine. Its overlap record (`recordId(machine, mode)`) feeds the overlap and coverage panel.

## Decisions left to you

1. **Name cues for context.** Names often state what the action doesn't: "seated" leg curl (hip flexed), "seated" calf (knee flexed), "reclining" leg extension. Using them would resolve many unresolved regions. It isn't done, because you asked for muscles derived from the recorded action.
2. **Bell-shaped = MID-RANGE?** If yes, the two could be compared.
3. **Compound knee + hip extension.** Should leg presses and squats also count for Gluteus maximus — Lower, Hamstrings — Upper, Adductors — Hip extension and the rectus femoris regions? They're currently unresolved.
4. **Source data to check** (see REVIEW.md):
   - 11 rows record a mode their name doesn't mention. Ten are rows recorded with a pulldown mode; the eleventh is a dip machine recorded with a chin mode.
   - Two "Reverse Fly" machines are recorded as horizontal *flexion*.
   - "Vertical Pek Dek" is recorded with elbow extension.
   - "Ultra Base Trim Glute" G7-S79B shares a name with G7-S78B, while the Ultra line's G7-S79 is "Ultra Hip Thrust".
5. **Setting-dependent profiles.** For PRIME, Biodrive and Ground Base Multi-Squat machines, the setting used could be recorded per exercise, making them comparable.
