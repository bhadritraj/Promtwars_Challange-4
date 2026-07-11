/**
 * VolunteerIQ 2026 — App Logic
 * Single persona: World Cup volunteer. Handles CSV data upload (real data,
 * not just synthetic scenarios), the reasoning assistant form, and the
 * shift log. Exposes AppCore on window for the test suite to exercise
 * directly (no DOM scraping needed for logic tests).
 */

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
    if (this.logEntries.length > 100) this.logEntries.pop();
    return this.logEntries[0];
  },

  /** Determine severity purely from data, used by both UI and tests. */
  classifySeverity(capacity, waitMinutes) {
    let severity = 'normal';
    if (capacity !== undefined) {
      if (capacity >= 90) severity = 'critical';
      else if (capacity >= 75) severity = 'elevated';
    }
    if (waitMinutes !== undefined) {
      if (waitMinutes >= 25) severity = 'critical';
      else if (waitMinutes >= 15 && severity !== 'critical') severity = 'elevated';
    }
    return severity;
  }
};

// ---------------------------------------------------------------------
// DOM wiring (skipped entirely in non-browser test contexts)
// ---------------------------------------------------------------------
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) lucide.createIcons();

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
      responseArea: document.getElementById('responseArea'),
      submitReport: document.getElementById('submitReport'),
      shiftLog: document.getElementById('shiftLog'),
      logCount: document.getElementById('logCount')
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

    // ---- CSV upload ----
    function renderZoneTable() {
      const names = Object.keys(AppCore.zones);
      els.zoneForReport.innerHTML = '<option value="">Select zone (optional)</option>' +
        names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

      if (!names.length) {
        els.zoneTableBody.innerHTML = '<tr><td colspan="4" class="empty-row">No data loaded yet — load sample data or upload a CSV.</td></tr>';
        return;
      }
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

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = String(s);
      return d.innerHTML;
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

    // ---- Quick chips ----
    els.quickChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      els.reportInput.value = btn.dataset.text;
      els.reportInput.focus();
    });

    // ---- Reasoning response rendering ----
    function renderReasoningBlock(rawText) {
      // Turn OBSERVATION:/DATA:/... labeled sections into styled blocks.
      const labels = ['OBSERVATION', 'DATA', 'REASONING', 'RECOMMENDATION', 'VOLUNTEER SCRIPT'];
      let html = escapeHtml(rawText);
      labels.forEach(label => {
        const re = new RegExp('(^|\\n)' + label + ':', 'g');
        html = html.replace(re, `$1<strong class="section">${label}</strong>`);
      });
      els.responseArea.innerHTML = html;
    }

    function addShiftLogUI(text, severity) {
      const entry = AppCore.addLogEntry({ text, severity });
      const li = document.createElement('li');
      li.className = 'sev-' + severity;
      const time = entry.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      li.innerHTML = `<span class="t">${time}</span><span>${escapeHtml(text)}</span>`;
      els.shiftLog.prepend(li);
      els.logCount.textContent = AppCore.logEntries.length;
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
      const context = {
        zone: zoneName || undefined,
        capacity: zoneData.capacity,
        waitMinutes: zoneData.waitMinutes,
        headcount: zoneData.headcount,
        language: els.languageSelect.value || undefined,
        dataSource: zoneName ? 'uploaded/sample CSV' : undefined
      };

      els.submitReport.disabled = true;
      els.submitReport.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Reasoning...';
      if (window.lucide) lucide.createIcons();
      els.responseArea.innerHTML = '<p class="placeholder">Thinking through observation → data → reasoning...</p>';

      let fullText = '';
      try {
        const { mode } = await GeminiService.ask(text, context, (chunk) => {
          fullText += chunk;
          renderReasoningBlock(fullText);
        });
        if (mode === 'live') updateModeBadge();
      } catch (err) {
        els.responseArea.innerHTML = `<p class="placeholder">Something went wrong generating a response: ${escapeHtml(err.message || String(err))}. Please try again.</p>`;
        console.error(err);
      } finally {
        els.submitReport.disabled = false;
        els.submitReport.innerHTML = '<i data-lucide="send"></i> Get Reasoning';
        if (window.lucide) lucide.createIcons();
      }

      const severity = AppCore.classifySeverity(context.capacity, context.waitMinutes);
      addShiftLogUI(text + (zoneName ? ` (${zoneName})` : ''), severity);
    });
  });
}

// Export for Node-based test running (tests.js can run in-browser or headless)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AppCore };
}
