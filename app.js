/**
 * VolunteerIQ 2026 — App Logic
 * Single persona: World Cup volunteer. Handles CSV data upload (real data,
 * not just synthetic scenarios), the reasoning assistant form, and the
 * shift log. Exposes AppCore on window for the test suite to exercise
 * directly (no DOM scraping needed for logic tests).
 */

const APP_CFG = (typeof module !== 'undefined' && module.exports)
  ? require('./constants.js')
  : { SEVERITY_THRESHOLDS, REPEAT_WINDOW_MINUTES, MAX_LOG_ENTRIES, HISTORY_COUNT_FOR_AI };


const AppCore = {
  zones: {}, // { zoneName: {capacity, waitMinutes, headcount} }
  logEntries: [],

  /**
   * Parses raw CSV text into a zones map.
   * Expected header: zone,capacity,waitMinutes,headcount
   * Handles: empty input, missing headers, extra/missing columns,
   * non-numeric values, blank lines, and mixed case headers.
   * Never throws — returns {zones, errors} so the UI can show partial data.
   */
  parseCSV(raw) {
    const result = { zones: {}, errors: [] };
    if (typeof raw !== 'string' || !raw.trim()) {
      result.errors.push('File is empty.');
      return result;
    }

    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      result.errors.push('CSV needs a header row and at least one data row.');
      return result;
    }

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const idx = {
      zone: header.indexOf('zone'),
      capacity: header.indexOf('capacity'),
      waitMinutes: header.indexOf('waitminutes'),
      headcount: header.indexOf('headcount')
    };

    if (idx.zone === -1) {
      result.errors.push('CSV must have a "zone" column.');
      return result;
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const zoneName = cols[idx.zone];
      if (!zoneName) {
        result.errors.push(`Row ${i + 1}: missing zone name, skipped.`);
        continue;
      }

      const entry = {};
      if (idx.capacity !== -1) {
        const v = Number(cols[idx.capacity]);
        entry.capacity = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : undefined;
        if (cols[idx.capacity] && !Number.isFinite(v)) {
          result.errors.push(`Row ${i + 1}: capacity "${cols[idx.capacity]}" is not a number, ignored.`);
        }
      }
      if (idx.waitMinutes !== -1) {
        const v = Number(cols[idx.waitMinutes]);
        entry.waitMinutes = Number.isFinite(v) ? Math.max(0, v) : undefined;
      }
      if (idx.headcount !== -1) {
        const v = Number(cols[idx.headcount]);
        entry.headcount = Number.isFinite(v) ? Math.max(0, v) : undefined;
      }

      result.zones[zoneName] = entry;
    }

    if (Object.keys(result.zones).length === 0) {
      result.errors.push('No valid rows found after parsing.');
    }

    return result;
  },

  loadZones(zonesObj) {
    this.zones = zonesObj || {};
  },

  addLogEntry(entry) {
    this.logEntries.unshift({ ...entry, ts: new Date() });
    if (this.logEntries.length > APP_CFG.MAX_LOG_ENTRIES) this.logEntries.pop();
    return this.logEntries[0];
  },

  /**
   * Counts prior reports on the same zone within the given window (minutes),
   * excluding the current one being composed. This is what makes the AI
   * "remember" the shift instead of treating every message as isolated.
   */
  getRecentReportsForZone(zoneName, withinMinutes = APP_CFG.REPEAT_WINDOW_MINUTES, now = new Date()) {
    if (!zoneName) return 0;
    const cutoff = now.getTime() - withinMinutes * 60000;
    return this.logEntries.filter(e => e.zone === zoneName && e.ts.getTime() >= cutoff).length;
  },

  /** Last N log entries formatted for passing to the AI as conversation history. */
  getRecentHistory(count = APP_CFG.HISTORY_COUNT_FOR_AI) {
    return this.logEntries.slice(0, count).map(e => ({ text: e.text, zone: e.zone, severity: e.severity }));
  },

  /** Determine severity purely from data, used by both UI and tests. */
  classifySeverity(capacity, waitMinutes) {
    let severity = 'normal';
    if (capacity !== undefined) {
      if (capacity >= APP_CFG.SEVERITY_THRESHOLDS.CRITICAL_CAPACITY_PCT) severity = 'critical';
      else if (capacity >= APP_CFG.SEVERITY_THRESHOLDS.ELEVATED_CAPACITY_PCT) severity = 'elevated';
    }
    if (waitMinutes !== undefined) {
      if (waitMinutes >= APP_CFG.SEVERITY_THRESHOLDS.CRITICAL_WAIT_MIN) severity = 'critical';
      else if (waitMinutes >= APP_CFG.SEVERITY_THRESHOLDS.ELEVATED_WAIT_MIN && severity !== 'critical') severity = 'elevated';
    }
    return severity;
  }
};

// ---------------------------------------------------------------------
// Shared pure helpers (module scope: reusable outside the DOM-wiring
// closure, and safe to call even where `document` exists but no icons
// are loaded yet).
// ---------------------------------------------------------------------
function escapeHtml(s) {
  if (typeof document === 'undefined') {
    // Minimal fallback for non-browser contexts (kept in sync with the
    // DOM-based version's behavior for the characters that matter).
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function refreshIcons() {
  if (typeof window !== 'undefined' && window.lucide) window.lucide.createIcons();
}

// ---------------------------------------------------------------------
// DOM wiring (skipped entirely in non-browser test contexts)
// ---------------------------------------------------------------------
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    refreshIcons();

    const els = {
      themeToggle: document.getElementById('themeToggle'),
      settingsBtn: document.getElementById('settingsBtn'),
      settingsDialog: document.getElementById('settingsDialog'),
      apiKeyInput: document.getElementById('apiKeyInput'),
      clearKeyBtn: document.getElementById('clearKeyBtn'),
      modeBadge: document.getElementById('modeBadge'),
      dropZone: document.getElementById('dropZone'),
      browseBtn: document.getElementById('browseBtn'),
      sampleBtn: document.getElementById('sampleBtn'),
      csvInput: document.getElementById('csvInput'),
      uploadStatus: document.getElementById('uploadStatus'),
      zoneTableBody: document.getElementById('zoneTableBody'),
      zoneForReport: document.getElementById('zoneForReport'),
      languageSelect: document.getElementById('languageSelect'),
      quickChips: document.getElementById('quickChips'),
      reportForm: document.getElementById('reportForm'),
      reportInput: document.getElementById('reportInput'),
      formError: document.getElementById('formError'),
      conversation: document.getElementById('conversation'),
      submitReport: document.getElementById('submitReport'),
      shiftLog: document.getElementById('shiftLog'),
      logCount: document.getElementById('logCount'),
      summaryBtn: document.getElementById('summaryBtn'),
      summaryPanel: document.getElementById('summaryPanel'),
      summaryContent: document.getElementById('summaryContent'),
      stadiumMap: document.getElementById('stadiumMap'),
      mapHint: document.querySelector('.map-hint')
    };

    // ---- Theme ----
    if (localStorage.getItem('viq_theme') === 'high-contrast') {
      document.body.classList.add('high-contrast');
    }
    els.themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('high-contrast');
      localStorage.setItem('viq_theme', document.body.classList.contains('high-contrast') ? 'high-contrast' : 'default');
    });

    // ---- Settings / API key ----
    els.settingsBtn.addEventListener('click', () => {
      els.apiKeyInput.value = GeminiService.getApiKey();
      els.settingsDialog.showModal();
    });
    els.settingsDialog.addEventListener('close', () => {
      if (els.settingsDialog.returnValue !== 'cancel') {
        GeminiService.setApiKey(els.apiKeyInput.value);
        updateModeBadge();
      }
    });
    els.clearKeyBtn.addEventListener('click', () => {
      GeminiService.setApiKey('');
      els.apiKeyInput.value = '';
      updateModeBadge();
      els.settingsDialog.close('cancel');
    });

    function updateModeBadge() {
      const live = GeminiService.isLiveMode();
      els.modeBadge.textContent = live ? 'Live Gemini mode' : 'Offline reasoning engine';
      els.modeBadge.className = 'mode-badge ' + (live ? 'live' : 'offline');
    }
    updateModeBadge();

    // ---- Live Stadium Map (SVG) ----
    const SVG_NS = 'http://www.w3.org/2000/svg';
    let selectedZone = '';

    function layoutPositions(count) {
      // Evenly distribute zones on an ellipse around a central "pitch".
      const cx = 300, cy = 170, rx = 240, ry = 120;
      const positions = [];
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        positions.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
      }
      return positions;
    }

    function renderStadiumMap() {
      const names = Object.keys(AppCore.zones);
      const svg = els.stadiumMap;
      svg.innerHTML = '';

      // Pitch
      const pitch = document.createElementNS(SVG_NS, 'ellipse');
      pitch.setAttribute('cx', '300'); pitch.setAttribute('cy', '170');
      pitch.setAttribute('rx', '150'); pitch.setAttribute('ry', '70');
      pitch.setAttribute('fill', 'none');
      pitch.setAttribute('stroke', 'var(--border)');
      pitch.setAttribute('stroke-width', '2');
      pitch.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(pitch);

      if (!names.length) {
        els.mapHint.textContent = 'No data loaded — showing placeholder layout.';
        const placeholder = document.createElementNS(SVG_NS, 'text');
        placeholder.setAttribute('x', '300'); placeholder.setAttribute('y', '175');
        placeholder.setAttribute('text-anchor', 'middle');
        placeholder.setAttribute('fill', 'var(--text-dim)');
        placeholder.setAttribute('font-size', '13');
        placeholder.textContent = 'Load zone data to populate the map';
        svg.appendChild(placeholder);
        return;
      }
      els.mapHint.textContent = `${names.length} zone(s) live.`;

      const positions = layoutPositions(names.length);
      names.forEach((name, i) => {
        const z = AppCore.zones[name];
        const sev = AppCore.classifySeverity(z.capacity, z.waitMinutes);
        const pos = positions[i];

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', `zone-node sev-${sev}${name === selectedZone ? ' selected' : ''}`);
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-label', `${name}, ${sev} severity, capacity ${z.capacity ?? 'unknown'} percent. Click to report on this zone.`);

        if (sev === 'critical') {
          const pulse = document.createElementNS(SVG_NS, 'circle');
          pulse.setAttribute('class', 'pulse');
          pulse.setAttribute('cx', pos.x); pulse.setAttribute('cy', pos.y); pulse.setAttribute('r', '20');
          g.appendChild(pulse);
        }

        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('class', 'base');
        circle.setAttribute('cx', pos.x); circle.setAttribute('cy', pos.y); circle.setAttribute('r', '26');
        g.appendChild(circle);

        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'zlabel');
        label.setAttribute('x', pos.x); label.setAttribute('y', pos.y - 2);
        label.setAttribute('text-anchor', 'middle');
        label.textContent = name.length > 12 ? name.slice(0, 11) + '…' : name;
        g.appendChild(label);

        const val = document.createElementNS(SVG_NS, 'text');
        val.setAttribute('class', 'zval');
        val.setAttribute('x', pos.x); val.setAttribute('y', pos.y + 11);
        val.setAttribute('text-anchor', 'middle');
        val.textContent = z.capacity !== undefined ? `${z.capacity}%` : '—';
        g.appendChild(val);

        function activate() {
          els.zoneForReport.value = name;
          selectedZone = name;
          renderStadiumMap();
          els.reportInput.focus();
        }
        g.addEventListener('click', activate);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });

        svg.appendChild(g);
      });
    }

    // ---- CSV upload / zone table ----
    function renderZoneTable() {
      const names = Object.keys(AppCore.zones);
      els.zoneForReport.innerHTML = '<option value="">Select zone (optional)</option>' +
        names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

      if (!names.length) {
        els.zoneTableBody.innerHTML = '<tr><td colspan="4" class="empty-row">No data loaded yet — load sample data or upload a CSV.</td></tr>';
      } else {
        els.zoneTableBody.innerHTML = names.map(n => {
          const z = AppCore.zones[n];
          const sev = AppCore.classifySeverity(z.capacity, z.waitMinutes);
          const capClass = sev === 'critical' ? 'cap-high' : sev === 'elevated' ? 'cap-mid' : 'cap-ok';
          return `<tr>
            <td>${escapeHtml(n)}</td>
            <td class="${capClass}">${z.capacity !== undefined ? z.capacity + '%' : '—'}</td>
            <td>${z.waitMinutes !== undefined ? z.waitMinutes + ' min' : '—'}</td>
            <td>${z.headcount !== undefined ? z.headcount : '—'}</td>
          </tr>`;
        }).join('');
      }
      renderStadiumMap();
    }

    function handleFile(file) {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.csv')) {
        setUploadStatus('Please upload a .csv file.', true);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => setUploadStatus('Could not read the file. Try again.', true);
      reader.onload = () => {
        const { zones, errors } = AppCore.parseCSV(reader.result);
        if (Object.keys(zones).length) {
          AppCore.loadZones(zones);
          renderZoneTable();
        }
        if (errors.length && Object.keys(zones).length) {
          setUploadStatus(`Loaded ${Object.keys(zones).length} zone(s) with ${errors.length} warning(s). See console.`, false);
          console.warn('CSV warnings:', errors);
        } else if (errors.length) {
          setUploadStatus(errors[0], true);
        } else {
          setUploadStatus(`Loaded ${Object.keys(zones).length} zone(s) from ${file.name}.`, false);
        }
      };
      reader.readAsText(file);
    }

    function setUploadStatus(msg, isError) {
      els.uploadStatus.textContent = msg;
      els.uploadStatus.className = 'status-line' + (isError ? ' error' : '');
    }

    els.browseBtn.addEventListener('click', () => els.csvInput.click());
    els.dropZone.addEventListener('click', (e) => { if (e.target === els.dropZone) els.csvInput.click(); });
    els.dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') els.csvInput.click(); });
    els.csvInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZone.style.borderColor = 'var(--accent)'; });
    els.dropZone.addEventListener('dragleave', () => { els.dropZone.style.borderColor = ''; });
    els.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropZone.style.borderColor = '';
      handleFile(e.dataTransfer.files[0]);
    });

    const SAMPLE_CSV = `zone,capacity,waitMinutes,headcount
Gate A,62,6,410
Gate B,78,14,530
Gate C,93,27,690
West Concourse,45,3,220
Transit Hub,81,18,340`;

    els.sampleBtn.addEventListener('click', () => {
      const { zones, errors } = AppCore.parseCSV(SAMPLE_CSV);
      AppCore.loadZones(zones);
      renderZoneTable();
      setUploadStatus(`Loaded ${Object.keys(zones).length} sample zone(s).`, false);
    });

    renderStadiumMap(); // initial placeholder render

    // ---- Quick chips ----
    els.quickChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      els.reportInput.value = btn.dataset.text;
      els.reportInput.focus();
    });

    // ---- Chat conversation rendering ----
    function markupReasoning(rawText) {
      const labels = ['OBSERVATION', 'DATA', 'REASONING', 'RECOMMENDATION', 'VOLUNTEER SCRIPT'];
      let html = escapeHtml(rawText);
      labels.forEach(label => {
        const re = new RegExp('(^|\\n)' + label + ':', 'g');
        html = html.replace(re, `$1<strong class="section">${label}</strong>`);
      });
      return html;
    }

    function clearConversationPlaceholder() {
      const ph = els.conversation.querySelector('.placeholder');
      if (ph) ph.remove();
    }

    function addVolunteerBubble(text, zoneName, repeatCount) {
      clearConversationPlaceholder();
      const div = document.createElement('div');
      div.className = 'bubble volunteer';
      const metaBits = [];
      if (zoneName) metaBits.push(zoneName);
      if (repeatCount > 0) metaBits.push(`repeat #${repeatCount + 1} on this zone`);
      div.innerHTML = `${metaBits.length ? `<div class="meta">${escapeHtml(metaBits.join(' • '))}</div>` : ''}${escapeHtml(text)}`;
      els.conversation.appendChild(div);
      els.conversation.scrollTop = els.conversation.scrollHeight;
      return div;
    }

    function addAiBubble() {
      clearConversationPlaceholder();
      const div = document.createElement('div');
      div.className = 'bubble ai';
      div.innerHTML = '<span class="meta">VolunteerIQ</span><p class="placeholder" style="margin:0">Thinking through observation → data → reasoning…</p>';
      els.conversation.appendChild(div);
      els.conversation.scrollTop = els.conversation.scrollHeight;
      return div;
    }

    function addShiftLogUI(text, severity, zoneName) {
      const entry = AppCore.addLogEntry({ text, severity, zone: zoneName || undefined });
      const li = document.createElement('li');
      li.className = 'sev-' + severity;
      const time = entry.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      li.innerHTML = `<span class="t">${time}</span><span>${escapeHtml(text)}</span>`;
      els.shiftLog.prepend(li);
      els.logCount.textContent = AppCore.logEntries.length;
      els.summaryBtn.disabled = AppCore.logEntries.length === 0;
    }

    // ---- Report form submit ----
    els.reportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      els.formError.textContent = '';

      const text = els.reportInput.value.trim();
      if (!text) {
        els.formError.textContent = 'Please describe what you\'re observing before submitting.';
        els.reportInput.focus();
        return;
      }
      if (text.length < 4) {
        els.formError.textContent = 'That description is too short to reason about — add a bit more detail.';
        return;
      }

      const zoneName = els.zoneForReport.value;
      const zoneData = zoneName && AppCore.zones[zoneName] ? AppCore.zones[zoneName] : {};
      const repeatCount = AppCore.getRecentReportsForZone(zoneName);
      const history = AppCore.getRecentHistory(3);
      const context = {
        zone: zoneName || undefined,
        capacity: zoneData.capacity,
        waitMinutes: zoneData.waitMinutes,
        headcount: zoneData.headcount,
        language: els.languageSelect.value || undefined,
        dataSource: zoneName ? 'uploaded/sample CSV' : undefined,
        repeatCount,
        history
      };

      addVolunteerBubble(text, zoneName, repeatCount);
      const aiBubble = addAiBubble();

      els.submitReport.disabled = true;
      els.submitReport.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Reasoning...';
      refreshIcons();

      let fullText = '';
      let sevForBubble = AppCore.classifySeverity(context.capacity, context.waitMinutes);
      if (repeatCount > 0 && sevForBubble === 'normal') sevForBubble = 'elevated';
      if (repeatCount >= 2) sevForBubble = 'critical';
      aiBubble.className = 'bubble ai sev-' + sevForBubble;

      try {
        const { mode } = await GeminiService.ask(text, context, (chunk) => {
          fullText += chunk;
          aiBubble.innerHTML = '<span class="meta">VolunteerIQ</span>' + markupReasoning(fullText);
          els.conversation.scrollTop = els.conversation.scrollHeight;
        });
        if (mode === 'live') updateModeBadge();
      } catch (err) {
        aiBubble.innerHTML = `<span class="meta">VolunteerIQ</span><p style="margin:0">Something went wrong generating a response: ${escapeHtml(err.message || String(err))}. Please try again.</p>`;
        console.error(err);
      } finally {
        els.submitReport.disabled = false;
        els.submitReport.innerHTML = '<i data-lucide="send"></i> Get Reasoning';
        refreshIcons();
      }

      addShiftLogUI(text + (zoneName ? ` (${zoneName})` : ''), sevForBubble, zoneName);
      els.reportInput.value = '';
    });

    // ---- End-of-shift summary ----
    els.summaryBtn.addEventListener('click', async () => {
      els.summaryPanel.hidden = false;
      els.summaryBtn.disabled = true;
      els.summaryBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Summarizing...';
      refreshIcons();
      els.summaryContent.innerHTML = '<p class="placeholder">Reviewing the full shift log…</p>';

      let fullText = '';
      try {
        await GeminiService.summarizeShift(AppCore.logEntries, (chunk) => {
          fullText += chunk;
          els.summaryContent.innerHTML = markupReasoning(fullText);
        });
      } catch (err) {
        els.summaryContent.innerHTML = `<p class="placeholder">Could not generate a summary: ${escapeHtml(err.message || String(err))}</p>`;
        console.error(err);
      } finally {
        els.summaryBtn.disabled = AppCore.logEntries.length === 0;
        els.summaryBtn.innerHTML = '<i data-lucide="file-text"></i> Regenerate Summary';
        refreshIcons();
        els.summaryPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

// Export for Node-based test running (tests.js can run in-browser or headless)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AppCore };
}
