# LinkedIn Post Draft — VolunteerIQ 2026

*(Mandatory submission artifact — post this alongside the deployed link. Edit the [bracketed] bits before posting.)*

---

Just wrapped up Challenge 4 of [PromptWars] — and the most useful thing I did was throw away two-thirds of my own build.

I started with "StadiaIQ": a stadium ops dashboard for staff, a fan-facing chatbot, and an eco-scanner, all in one app. It looked impressive. It was also exactly the trap the brief warned against — the problem statement says "fans **or** organizers **or** volunteers **or** venue staff." That "or" means pick one and go deep. I'd built something wide and shallow instead.

So I rebuilt it as **VolunteerIQ**: one persona (a World Cup volunteer on shift), two jobs (crowd management + multilingual fan support), and nothing else.

**What changed, concretely:**

🔹 **Reasoning over answers.** The brief's real test wasn't "can the AI answer a question" — it's whether the AI's involvement *actually matters*, or whether the same output could come from a plain if/else. So every response now follows a forced structure: Observation → Data → Reasoning → Recommendation → Volunteer script. The reasoning step has to cite the actual numbers and explain the threshold logic, not just state a conclusion.

🔹 **Real data, not just demo scenarios.** Judges can upload their own CSV of zone capacity/wait-time data and watch the AI's recommendations change based on the real numbers — not a fixed set of pre-baked scenarios.

🔹 **Edge cases, not just happy path.** My first test suite only tested "it works." The rebuild has 27 tests, and most of them are edge cases: empty uploads, malformed CSV rows, non-numeric values, boundary conditions on severity thresholds, empty form submissions. That's apparently where most teams lose testing points.

🔹 **Works with zero setup.** A built-in offline reasoning engine mirrors the exact structure of the live Gemini output, so the app is fully functional for judges without an API key — and gracefully falls back to it if a live key fails.

**How my prompting evolved:** my first system prompt just asked the model to "help a volunteer." It produced generic, safe, forgettable output. The version that shipped forces a rigid 5-section contract with explicit instructions to cite the actual context numbers and never use filler like "monitor the situation" — that constraint is what turned "an answer" into visible reasoning.

**What GenAI handled vs. what I designed:** the model generates the natural-language reasoning and phrasing. I designed the reasoning contract itself, the severity thresholds, the CSV parsing and its failure modes, the fallback engine, and the test suite — the AI reasons *inside* a structure I built, it doesn't define the structure.

Deployed link: [your GitHub Pages URL]
Repo: [your repo URL]

#PromptWars #GenAI #Gemini #WorldCup2026 #HackathonBuild
