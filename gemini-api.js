/**
 * VolunteerIQ 2026 — GenAI Reasoning Engine
 * Handles connection to Google's Gemini API and a context-aware offline
 * simulation fallback. Both paths are forced through the SAME reasoning
 * contract: Observation -> Data Check -> Reasoning -> Recommendation.
 * This is what lets the app work with zero API key AND with a real key,
 * without changing behavior or UI.
 */

const REASONING_CONTRACT = `You are VolunteerIQ, a reasoning assistant for World Cup 2026 volunteers.
You NEVER answer with just a fact. Every response MUST follow this exact structure,
using these exact section headers, in this order:

OBSERVATION: Restate what the volunteer reported, in one sentence.
DATA: Cite the specific numbers you were given in context (capacity %, wait time, zone, headcount). If no data was provided, say "No live data provided" and reason from general crowd-safety practice instead. If REPEAT COUNT is greater than 0, state it explicitly (e.g. "This is the 2nd report on this zone in the last 15 minutes").
REASONING: Explain, step by step, WHY you are about to recommend what you recommend. Reference the data AND the repeat count. A repeated report on the same zone is itself evidence — it means the last recommendation didn't fully resolve things, so escalate your response rather than repeating the same advice.
RECOMMENDATION: The concrete action(s) the volunteer should take right now, numbered. If this is a repeat report (2nd+), the action MUST be a step up from a first report (e.g. involve a supervisor, close a lane, request backup) — do not just restate the same first-report action.
VOLUNTEER SCRIPT: One short sentence in plain language the volunteer can literally say to a fan or radio to their supervisor.

Keep the whole answer under 160 words. Be concrete, never generic filler like "monitor the situation".`;

const SUMMARY_CONTRACT = `You are VolunteerIQ, generating an end-of-shift handoff brief for the volunteer coordinator taking the next shift.
You are given a chronological log of everything this volunteer reported. Produce EXACTLY this structure, these headers, in this order:

SHIFT OVERVIEW: One or two sentences on the overall tone of the shift (calm / busy / high-incident), based on the actual count and severity of entries given.
KEY INCIDENTS: The 2-4 most important entries, each one line, most severe first. If fewer than 2 entries exist, say so honestly rather than inventing incidents.
PATTERNS DETECTED: Call out any zone that was reported more than once — that is a real signal, not noise — and any trend in severity over the shift (getting worse / better / stable). If there is no repetition, say "No repeat patterns detected."
HANDOFF RECOMMENDATION: 1-3 concrete things the next shift's volunteer/coordinator should watch for or follow up on, derived from the incidents above — not generic advice.

Keep it under 180 words. Base every line on the actual log data given — never invent an incident that isn't in the log.`;

const GeminiService = {
  getApiKey() {
    return localStorage.getItem('viq_gemini_key') || '';
  },

  setApiKey(key) {
    localStorage.setItem('viq_gemini_key', (key || '').trim());
  },

  isLiveMode() {
    return !!this.getApiKey();
  },

  /**
   * Primary entry point. Always routes through the reasoning contract.
   * @param {string} prompt - the volunteer's raw report/question
   * @param {object} context - live data: zone capacity, wait times, language, headcount
   * @param {function} onChunk - streaming callback
   */
  async ask(prompt, context = {}, onChunk = () => {}) {
    const apiKey = this.getApiKey();

    if (apiKey) {
      try {
        await this._callRealGemini(apiKey, prompt, context, onChunk);
        return { mode: 'live' };
      } catch (error) {
        console.error('Gemini API error, falling back to offline reasoning engine:', error);
        onChunk(`\n[System: Live Gemini call failed (${error.message}). Switching to offline reasoning engine.]\n\n`);
      }
    }

    await this._callSimulatedEngine(prompt, context, onChunk);
    return { mode: apiKey ? 'fallback' : 'offline' };
  },

  async _callRealGemini(apiKey, prompt, context, onChunk) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contextBlock = this._formatContext(context);
    const fullPrompt = `${contextBlock}\n\nVolunteer report: "${prompt}"`;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      systemInstruction: { parts: [{ text: REASONING_CONTRACT }] },
      generationConfig: { temperature: 0.6, maxOutputTokens: 500 }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        msg = errorData.error?.message || msg;
      } catch (_) { /* ignore parse failure */ }
      throw new Error(msg);
    }

    const data = await response.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResult) {
      throw new Error('Empty response from Gemini API');
    }

    await this._streamText(textResult, onChunk);
  },

  _formatContext(context) {
    const lines = [];
    if (context.zone) lines.push(`Zone: ${context.zone}`);
    if (context.capacity !== undefined) lines.push(`Current capacity: ${context.capacity}%`);
    if (context.waitMinutes !== undefined) lines.push(`Current wait time: ${context.waitMinutes} min`);
    if (context.headcount !== undefined) lines.push(`Estimated headcount: ${context.headcount}`);
    if (context.language) lines.push(`Fan's language: ${context.language}`);
    if (context.dataSource) lines.push(`Data source: ${context.dataSource}`);
    lines.push(`Repeat count on this zone (last 15 min, excluding this report): ${context.repeatCount || 0}`);
    if (context.history && context.history.length) {
      lines.push('Recent shift history (most recent last):');
      context.history.forEach(h => lines.push(`  - "${h.text}"${h.zone ? ' (' + h.zone + ')' : ''} — ${h.severity}`));
    }
    if (!lines.length) return 'Live context: none supplied.';
    return 'Live context:\n' + lines.map(l => `- ${l}`).join('\n');
  },

  async _streamText(text, onChunk) {
    const words = text.split(/(\s+)/);
    for (const word of words) {
      onChunk(word);
      await new Promise(r => setTimeout(r, 12));
    }
  },

  /**
   * Offline reasoning engine — same OBSERVATION/DATA/REASONING/RECOMMENDATION
   * structure, computed from actual context numbers, not canned strings.
   * This is a genuine rule+template reasoning composer, not just keyword
   * matching to a fixed paragraph: the numbers plugged in change the
   * recommendation logic (thresholds), not just cosmetic text.
   */
  async _callSimulatedEngine(prompt, context, onChunk) {
    const text = this._composeReasoning(prompt, context);
    await this._streamText(text, onChunk);
  },

  _composeReasoning(prompt, context) {
    const p = (prompt || '').toLowerCase().trim();
    const zone = context.zone || 'the reported zone';
    const capacity = context.capacity;
    const wait = context.waitMinutes;
    const headcount = context.headcount;
    const hasData = capacity !== undefined || wait !== undefined || headcount !== undefined;
    const repeatCount = context.repeatCount || 0;
    const isRepeat = repeatCount > 0;

    if (!p) {
      return `OBSERVATION: No report text was provided.
DATA: ${hasData ? `Zone ${zone} data on file (capacity ${capacity ?? 'n/a'}%, wait ${wait ?? 'n/a'} min).` : 'No live data provided.'}
REASONING: I cannot reason about an action without a description of what you observed. Guessing would risk sending you to the wrong location.
RECOMMENDATION: 1) Type what you're seeing (e.g. "long line at Gate C") or 2) select a quick-report chip below.
VOLUNTEER SCRIPT: "One moment, let me confirm the situation before I direct you."`;
    }

    // Determine severity from actual numbers when present
    let severity = 'normal';
    if (capacity !== undefined) {
      if (capacity >= 90) severity = 'critical';
      else if (capacity >= 75) severity = 'elevated';
    }
    if (wait !== undefined && wait >= 15) severity = severity === 'critical' ? 'critical' : 'elevated';
    if (wait !== undefined && wait >= 25) severity = 'critical';
    // A second report on the same zone within the window is itself an escalation signal
    if (isRepeat && severity === 'normal') severity = 'elevated';
    if (repeatCount >= 2) severity = 'critical';

    const isCrowd = /(crowd|queue|line|congest|full|packed|bottleneck|gate)/.test(p);
    const isLost = /(lost|where|find|direction|help me get|how do i get)/.test(p);
    const isMedical = /(medical|injur|hurt|faint|collapse|sick|emergency)/.test(p);
    const isLanguage = /(speak|language|translate|understand|habla|parle)/.test(p);

    const dataLine = (hasData
      ? `Zone: ${zone}. Capacity: ${capacity !== undefined ? capacity + '%' : 'n/a'}. Wait: ${wait !== undefined ? wait + ' min' : 'n/a'}.${headcount !== undefined ? ' Headcount est.: ' + headcount + '.' : ''}`
      : 'No live data provided for this zone — reasoning from standard crowd-safety thresholds (75%+ capacity or 15+ min wait triggers escalation).')
      + (isRepeat ? ` This is report #${repeatCount + 1} on this zone in the last 15 minutes.` : '');

    if (isMedical) {
      return `OBSERVATION: You reported a possible medical situation in ${zone}.
DATA: ${dataLine}
REASONING: Medical incidents override all queue/crowd logic — safety of the individual takes priority over throughput, regardless of current capacity numbers${isRepeat ? ', and a repeat report on this zone means the first response has not resolved the situation' : ''}.
RECOMMENDATION: 1) Radio medical team on channel 3 now. 2) Create a 3-meter clear space around the person. 3) Do not move them unless there is immediate danger. 4) Log the incident time.${isRepeat ? ' 5) Since this is a repeat, escalate directly to your zone supervisor by name, not just channel 3.' : ''}
VOLUNTEER SCRIPT: "Medical support is on the way, please give us a little space."`;
    }

    if (isCrowd) {
      const action = repeatCount >= 2
        ? `This zone has now been flagged ${repeatCount + 1} times — escalate past self-service: radio your supervisor directly, request backup volunteers, and consider a temporary hold on new entries to ${zone} until backup arrives.`
        : isRepeat
        ? `Your earlier redirect for ${zone} hasn't held — step it up: escalate to your supervisor by radio and open a second lane rather than repeating the same soft redirect.`
        : severity === 'critical'
        ? `Close entry to ${zone} temporarily and open the nearest alternate gate; this is the standard response above the 90% / 25-min threshold.`
        : severity === 'elevated'
        ? `Open a second screening lane in ${zone} and softly redirect ~30% of new arrivals to a neighboring gate; this holds the queue below the 90% threshold without a full closure.`
        : `Continue normal flow monitoring in ${zone}; current numbers are below escalation thresholds so a diversion would waste volunteer capacity elsewhere.`;
      const reasoningLine = isRepeat
        ? `A repeat report on the same zone is itself evidence that the situation is not improving — treating this identically to a first report would be ignoring that signal. Escalating the response type (not just repeating advice) is the correct move.`
        : severity === 'critical'
        ? 'Capacity or wait time is at or beyond critical threshold, so risk of unsafe density outweighs the cost of a temporary diversion.'
        : severity === 'elevated'
        ? 'Numbers are above comfortable flow but not yet critical, so a partial redirect is proportionate — a full closure would be an overreaction.'
        : 'Numbers are within normal operating range, so the priority is watching the trend, not intervening.';
      return `OBSERVATION: You reported crowd/queue pressure at ${zone}.
DATA: ${dataLine}
REASONING: ${reasoningLine}
RECOMMENDATION: ${action}
VOLUNTEER SCRIPT: "${severity === 'critical' ? `This gate is temporarily paused — please follow me to the next entrance.` : `This line is moving, but there's a faster option just this way.`}"`;
    }

    if (isLost) {
      return `OBSERVATION: A fan needs directions near ${zone}.
DATA: ${dataLine}
REASONING: When a fan is lost, the fastest safe route matters more than the shortest route — a route through a congested area (per the data above) will feel slower even if it's geometrically closer.
RECOMMENDATION: 1) Confirm their destination (seat/gate/section). 2) Route them via the corridor with lower reported capacity. 3) Point out the nearest accessible landmark as a checkpoint.
VOLUNTEER SCRIPT: "Follow the blue signs, it's about a 4-minute walk from here."`;
    }

    if (isLanguage) {
      return `OBSERVATION: You need multilingual support for a fan.
DATA: ${context.language ? `Requested language: ${context.language}.` : 'No language specified yet.'}
REASONING: Matching the fan's exact language matters more than a generic translation, because idioms around directions ("left/right", "gate names") can confuse fans if translated too literally.
RECOMMENDATION: 1) Ask "What language do you speak?" 2) Use the phrase panel for that language. 3) Pair spoken words with pointing/gestures for direction-giving, since that's language-independent.
VOLUNTEER SCRIPT: "¿Habla inglés? / Do you speak English?" (adjust to the fan's likely language)`;
    }

    // Generic fallback reasoning for anything else
    return `OBSERVATION: You reported: "${prompt.slice(0, 120)}"
DATA: ${dataLine}
REASONING: This doesn't match a known high-priority pattern (medical, crowd, lost fan, language barrier), so I'm treating it as a general operations question and reasoning from the closest matching protocol.${isRepeat ? ' Since this has come up before this shift, it may be worth flagging as a recurring issue rather than a one-off.' : ''}
RECOMMENDATION: 1) Note the situation in the shift log. 2) If it escalates or you're unsure, radio your zone supervisor. 3) Re-check in 5 minutes if the situation is still developing.
VOLUNTEER SCRIPT: "Thanks for flagging this — I'll check and come right back to you."`;
  },

  /**
   * Generates an end-of-shift handoff brief from the full shift log.
   * Uses the same live/offline dual-path pattern as ask().
   */
  async summarizeShift(logEntries, onChunk = () => {}) {
    const apiKey = this.getApiKey();
    if (apiKey) {
      try {
        await this._callRealGeminiSummary(apiKey, logEntries, onChunk);
        return { mode: 'live' };
      } catch (error) {
        console.error('Gemini summary error, falling back:', error);
        onChunk(`\n[System: Live Gemini call failed (${error.message}). Switching to offline summary engine.]\n\n`);
      }
    }
    await this._streamText(this._composeSummary(logEntries), onChunk);
    return { mode: apiKey ? 'fallback' : 'offline' };
  },

  async _callRealGeminiSummary(apiKey, logEntries, onChunk) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const logText = logEntries.length
      ? logEntries.slice().reverse().map((e, i) => `${i + 1}. [${e.severity}] ${e.text}`).join('\n')
      : 'No entries logged this shift.';

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: `Shift log (chronological):\n${logText}` }] }],
      systemInstruction: { parts: [{ text: SUMMARY_CONTRACT }] },
      generationConfig: { temperature: 0.5, maxOutputTokens: 400 }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try { msg = (await response.json()).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }
    const data = await response.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) throw new Error('Empty response from Gemini API');
    await this._streamText(textResult, onChunk);
  },

  _composeSummary(logEntries) {
    if (!logEntries || logEntries.length === 0) {
      return `SHIFT OVERVIEW: No reports have been logged yet this shift — nothing to summarize.
KEY INCIDENTS: None recorded.
PATTERNS DETECTED: No repeat patterns detected.
HANDOFF RECOMMENDATION: 1) Confirm zone assignments with the next volunteer. 2) No open issues to hand off.`;
    }

    const counts = { critical: 0, elevated: 0, normal: 0 };
    const zoneFreq = {};
    logEntries.forEach(e => {
      counts[e.severity] = (counts[e.severity] || 0) + 1;
      const zoneMatch = e.text.match(/\(([^)]+)\)\s*$/);
      const z = zoneMatch ? zoneMatch[1] : null;
      if (z) zoneFreq[z] = (zoneFreq[z] || 0) + 1;
    });

    const tone = counts.critical >= 2 ? 'a high-incident shift' : counts.critical === 1 || counts.elevated >= 2 ? 'a moderately busy shift' : 'a calm, low-incident shift';

    const sorted = logEntries.slice().sort((a, b) => {
      const rank = { critical: 0, elevated: 1, normal: 2 };
      return rank[a.severity] - rank[b.severity];
    });
    const keyLines = sorted.slice(0, 4).map(e => `- [${e.severity.toUpperCase()}] ${e.text}`).join('\n');

    const repeats = Object.entries(zoneFreq).filter(([, c]) => c > 1);
    const patternLine = repeats.length
      ? repeats.map(([z, c]) => `${z} was reported ${c} times — treat as a structural issue, not a one-off.`).join(' ')
      : 'No repeat patterns detected.';

    const first = logEntries[logEntries.length - 1];
    const last = logEntries[0];
    const trend = first && last && first.severity !== last.severity
      ? `Severity trended from ${first.severity} toward ${last.severity} across the shift.`
      : 'Severity stayed roughly stable across the shift.';

    const handoff = repeats.length
      ? `1) Flag ${repeats[0][0]} to the next shift as an unresolved recurring issue. 2) Confirm whether backup was ever sent. 3) Watch that zone first on handover.`
      : counts.critical > 0
      ? `1) Confirm the critical incident(s) above were fully resolved before end of shift. 2) Brief the next volunteer verbally on the specific zone(s) involved.`
      : `1) No urgent handoff items. 2) Continue standard rotation monitoring.`;

    return `SHIFT OVERVIEW: This was ${tone} — ${logEntries.length} total report(s) logged (${counts.critical} critical, ${counts.elevated} elevated, ${counts.normal} normal).
KEY INCIDENTS:
${keyLines}
PATTERNS DETECTED: ${patternLine} ${trend}
HANDOFF RECOMMENDATION: ${handoff}`;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GeminiService };
}
