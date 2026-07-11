# VolunteerIQ 2026 — World Cup Volunteer Reasoning Assistant

A GenAI tool built for **one persona, one job**: a World Cup 2026 volunteer on shift, handling crowd management and multilingual fan support. This is a deliberate rebuild from a prior 3-persona version (staff + fan + eco-scanner) after realizing the challenge brief's "fans **or** organizers **or** volunteers **or** venue staff" meant *pick one and go deep*, not build something shallow for everyone.

---

## Why Volunteer, and why this narrow

Volunteers are the ones physically closest to a developing problem — a queue, a lost fan, a language barrier, a medical concern — but they usually have the least authority and the least context. The highest-leverage AI here isn't "answer a question," it's **help a volunteer reason under uncertainty, fast, with the data that's actually available.**

So the app does two things and nothing else:
1. **Crowd management** — read live zone data, reason about it, recommend an action.
2. **Multilingual fan support** — help a volunteer bridge a language gap in the moment.

No staff dashboard, no eco-scanner. Depth over breadth.

## The reasoning layer (not just canned answers)

Every response — live Gemini call or offline fallback — is forced through the same explicit structure:

```
OBSERVATION → DATA → REASONING → RECOMMENDATION → VOLUNTEER SCRIPT
```

The `REASONING` line has to explain *why*, using the actual numbers in context (capacity %, wait time), not a generic "please monitor the situation." This was a specific point raised in the challenge SME walkthrough: judges are checking whether GenAI usage functionally matters, or whether the same output could've come from a plain rule-based `if/else`. Making the reasoning step visible, and making it change based on real uploaded numbers (not just which button was clicked), is the answer to that check.

The offline engine isn't a keyword-matched string bank either — it computes severity from thresholds (75%/90% capacity, 15/25 min wait) and the *recommendation itself changes* depending on where the numbers land, with the reasoning explaining the threshold logic. Try loading the sample data and reporting "queue at Gate C" vs "queue at West Concourse" — you'll get different actions because the underlying numbers are different, not different button labels.

## Real data, not just synthetic scenarios

The left panel accepts a **CSV upload** (`zone,capacity,waitMinutes,headcount`). A judge can drop in their own numbers and the reasoning panel will respond to them directly — this isn't limited to pre-baked demo scenarios. `sample-data.csv` is included for a one-click way to see it work end to end.

## Tech stack

- Pure HTML5 / CSS3 / vanilla ES6 JS — no build step, no framework, deploys straight to GitHub Pages via the included Actions workflow.
- GenAI: real Gemini API call (`gemini-1.5-flash`) if a key is supplied in Settings, with an offline reasoning engine as a fallback (and as the default so judges can test with zero setup). Both paths return the same structured reasoning format.
- Client-side only key storage (`localStorage`); no backend, no database.

## How to test it (2 minutes)

1. Open `index.html`.
2. Click **Load sample data** in the left panel.
3. Click one of the quick-report chips (e.g. "Queue at Gate C"), pick that zone from the dropdown, hit **Get Reasoning**.
4. Compare the result against "Queue at West Concourse" — the recommendation logic differs because the zone data differs.
5. Try the multilingual chip, and try an edge case: submit the form with empty text (it should give a clear inline error, not silently fail).
6. Optional: add a real Gemini key in Settings (gear icon) to see live-mode responses; leaving it blank is fully supported.

## Testing

- `tests.html` — browser test runner (open directly, no server needed).
- `tests.js` — 27 tests, weighted toward edge cases per SME feedback (empty CSV, malformed rows, non-numeric values, boundary thresholds, empty form submission) rather than only the happy path. Also runnable headless: `node tests.js`.

## Accessibility

- Semantic landmarks, skip link, labeled form controls, `aria-live` regions for the reasoning output and status/error messages.
- High-contrast theme toggle.
- Keyboard-operable upload zone (Enter/Space triggers file picker).

## Deployment

Static site — push to a public repo, enable GitHub Pages, the included `.github/workflows/deploy.yml` handles the rest. No API key required for the deployed demo to be fully functional.

## What's GenAI vs. what's hand-designed

- **GenAI-authored**: the natural-language reasoning text itself (live mode), phrased recommendations, volunteer scripts.
- **Hand-designed**: the reasoning *contract* (the 5-section structure), the severity thresholds, the CSV parser and its edge-case handling, the offline fallback logic, all UI/UX, and the test suite. The AI reasons within a structure a human designed — it doesn't decide the thresholds or the app's behavior.
