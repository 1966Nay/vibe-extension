const statusEl      = document.getElementById('status');
const btnEl         = document.getElementById('extract-btn');
const progressWrap  = document.getElementById('progress-wrap');
const progressFill  = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');

const CHUNK_SIZE = 25; // files per round-trip into the page

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = type;
}

function setProgress(done, total) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${done} / ${total} files`;
  progressWrap.style.display = 'block';
}

function setProgressPct(pct) {
  progressFill.style.width = `${Math.min(pct, 100)}%`;
  progressLabel.textContent = `${Math.round(pct)}%`;
}

function hideProgress() {
  progressWrap.style.display = 'none';
  progressFill.style.width = '0%';
}

// ─── Injected into page MAIN world ────────────────────────────────────────────
// Gets project name and the ordered list of file paths (no content — small payload).
function getProjectMetadata() {
  try {
    const appEl = document.querySelector('#app');
    if (!appEl || !appEl.__vue_app__) return null;
    const pinia = appEl.__vue_app__.config.globalProperties.$pinia;
    if (!pinia || !pinia.state || !pinia.state.value) return null;
    const state = pinia.state.value;
    const rawFiles = state.preview && state.preview.files;
    if (!rawFiles) return null;

    let filePaths;
    if (Array.isArray(rawFiles)) {
      filePaths = rawFiles
        .filter(f => f && (f.path || f.name))
        .map(f => String(f.path || f.name));
    } else if (typeof rawFiles === 'object') {
      filePaths = Object.keys(rawFiles);
    } else {
      return null;
    }

    if (filePaths.length === 0) return null;

    return {
      projectName: (state.project && state.project.name) || 'vibe-project',
      filePaths
    };
  } catch (err) {
    return { error: err.message };
  }
}

// Injected into page MAIN world with args = [pathsChunk].
// Returns content only for the requested paths — keeps each IPC message small.
function extractFilesByPaths(paths) {
  try {
    const appEl = document.querySelector('#app');
    if (!appEl || !appEl.__vue_app__) return { error: 'No Vue app' };
    const pinia = appEl.__vue_app__.config.globalProperties.$pinia;
    if (!pinia || !pinia.state || !pinia.state.value) return { error: 'No Pinia state' };
    const state = pinia.state.value;
    const rawFiles = state.preview && state.preview.files;
    if (!rawFiles) return { error: 'No files in store' };

    const files = [];
    for (const path of paths) {
      let content = '';
      if (Array.isArray(rawFiles)) {
        const f = rawFiles.find(f => f && (f.path === path || f.name === path));
        content = f && f.content != null ? String(f.content) : '';
      } else if (typeof rawFiles === 'object') {
        const val = rawFiles[path];
        if (val && typeof val === 'object' && val.content !== undefined) {
          content = String(val.content);
        } else if (val != null) {
          content = String(val);
        }
      }
      files.push({ path, content });
    }
    return { files };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
btnEl.addEventListener('click', async () => {
  btnEl.disabled = true;
  hideProgress();
  setStatus('Querying active tab…', 'busy');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('view=codeEditor')) {
      setStatus('Not on a GHL AI Studio code editor page. Navigate there first.', 'error');
      btnEl.disabled = false;
      return;
    }

    setStatus('Scanning frames for vibe Pinia store…', 'busy');

    // Phase 1 — discover the frame and collect file paths (tiny payload)
    let metaResults;
    try {
      metaResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: getProjectMetadata,
        world: 'MAIN'
      });
    } catch (injErr) {
      setStatus(`Injection failed: ${injErr.message}`, 'error');
      btnEl.disabled = false;
      return;
    }

    const metaHit = metaResults.find(r => r.result && r.result.filePaths && r.result.filePaths.length > 0);

    if (!metaHit) {
      const errHit = metaResults.find(r => r.result && r.result.error);
      setStatus(
        errHit
          ? `Store error: ${errHit.result.error}`
          : 'Could not find the vibe Pinia store in any frame. Make sure the code editor is fully loaded.',
        'error'
      );
      btnEl.disabled = false;
      return;
    }

    const { projectName, filePaths } = metaHit.result;
    const frameId = metaHit.frameId;
    const total   = filePaths.length;

    if (typeof JSZip === 'undefined') {
      setStatus('JSZip not found. Run setup.ps1 to download lib/jszip.min.js, then reload the extension.', 'error');
      btnEl.disabled = false;
      return;
    }

    const zip = new JSZip();
    let extracted = 0;

    // Phase 2 — pull file content in chunks so each IPC message stays small
    for (let start = 0; start < total; start += CHUNK_SIZE) {
      setStatus(`Extracting files… ${extracted} / ${total}`, 'busy');
      setProgress(extracted, total);

      const chunkPaths = filePaths.slice(start, start + CHUNK_SIZE);

      let chunkResults;
      try {
        chunkResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [frameId] },
          func: extractFilesByPaths,
          args: [chunkPaths],
          world: 'MAIN'
        });
      } catch (injErr) {
        setStatus(`Extraction failed at file ${extracted + 1}: ${injErr.message}`, 'error');
        hideProgress();
        btnEl.disabled = false;
        return;
      }

      const result = chunkResults[0] && chunkResults[0].result;
      if (!result || result.error) {
        setStatus(`Extraction error: ${result ? result.error : 'No result from frame'}`, 'error');
        hideProgress();
        btnEl.disabled = false;
        return;
      }

      for (const file of result.files) {
        zip.file(file.path.replace(/^\/+/, ''), file.content);
      }
      extracted += result.files.length;
    }

    setProgress(total, total);
    setStatus(`Compressing ${total} file(s)…`, 'busy');

    // Phase 3 — generate zip; onUpdate keeps the progress bar alive during compression
    const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      setProgressPct(meta.percent);
      setStatus(`Compressing… ${Math.round(meta.percent)}%`, 'busy');
    });

    const safeName = projectName.replace(/[^\w.\-]/g, '_').replace(/^_+|_+$/g, '') || 'vibe-project';
    const filename  = `${safeName}.zip`;

    const objectUrl = URL.createObjectURL(blob);
    const anchor    = document.createElement('a');
    anchor.href     = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);

    hideProgress();
    setStatus(`Downloaded "${filename}" with ${total} file(s).`, 'success');
  } catch (err) {
    setStatus(`Unexpected error: ${err.message}`, 'error');
    hideProgress();
  }

  btnEl.disabled = false;
});
