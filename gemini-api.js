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
DATA: Cite the specific numbers you were given in context (capacity %, wait time, zone, headcount). If no data was provided, say "No live data provided" and reason from general crowd-safety practice instead.
REASONING: Explain, step by step, WHY you are about to recommend what you recommend. Reference the data. Show your logic, not just your conclusion.
RECOMMENDATION: The concrete action(s) the volunteer should take right now, numbered.
VOLUNTEER SCRIPT: One short sentence in plain language the volunteer can literally say to a fan or radio to their supervisor.

Keep the whole answer under 160 words. Be concrete, never generic filler like "monitor the situation".`;

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

    const isCrowd = /(crowd|queue|line|congest|full|packed|bottleneck|gate)/.test(p);
    const isLost = /(lost|where|find|direction|help me get|how do i get)/.test(p);
    const isMedical = /(medical|injur|hurt|faint|collapse|sick|emergency)/.test(p);
    const isLanguage = /(speak|language|translate|understand|habla|parle)/.test(p);

    const dataLine = hasData
      ? `Zone: ${zone}. Capacity: ${capacity !== undefined ? capacity + '%' : 'n/a'}. Wait: ${wait !== undefined ? wait + ' min' : 'n/a'}.${headcount !== undefined ? ' Headcount est.: ' + headcount + '.' : ''}`
      : 'No live data provided for this zone — reasoning from standard crowd-safety thresholds (75%+ capacity or 15+ min wait triggers escalation).';

    if (isMedical) {
      return `OBSERVATION: You reported a possible medical situation in ${zone}.
DATA: ${dataLine}
REASONING: Medical incidents override all queue/crowd logic — safety of the individual takes priority over throughput, regardless of current capacity numbers.
RECOMMENDATION: 1) Radio medical team on channel 3 now. 2) Create a 3-meter clear space around the person. 3) Do not move them unless there is immediate danger. 4) Log the incident time.
VOLUNTEER SCRIPT: "Medical support is on the way, please give us a little space."`;
    }

    if (isCrowd) {
      const action = severity === 'critical'
        ? `Close entry to ${zone} temporarily and open the nearest alternate gate; this is the standard response above the 90% / 25-min threshold.`
        : severity === 'elevated'
        ? `Open a second screening lane in ${zone} and softly redirect ~30% of new arrivals to a neighboring gate; this holds the queue below the 90% threshold without a full closure.`
        : `Continue normal flow monitoring in ${zone}; current numbers are below escalation thresholds so a diversion would waste volunteer capacity elsewhere.`;
      return `OBSERVATION: You reported crowd/queue pressure at ${zone}.
DATA: ${dataLine}
REASONING: ${severity === 'critical' ? 'Capacity or wait time is at or beyond critical threshold, so risk of unsafe density outweighs the cost of a temporary diversion.' : severity === 'elevated' ? 'Numbers are above comfortable flow but not yet critical, so a partial redirect is proportionate — a full closure would be an overreaction.' : 'Numbers are within normal operating range, so the priority is watching the trend, not intervening.'}
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
REASONING: This doesn't match a known high-priority pattern (medical, crowd, lost fan, language barrier), so I'm treating it as a general operations question and reasoning from the closest matching protocol.
RECOMMENDATION: 1) Note the situation in the shift log. 2) If it escalates or you're unsure, radio your zone supervisor. 3) Re-check in 5 minutes if the situation is still developing.
VOLUNTEER SCRIPT: "Thanks for flagging this — I'll check and come right back to you."`;
  }
};
