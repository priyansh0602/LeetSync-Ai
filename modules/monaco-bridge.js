// modules/monaco-bridge.js
(function () {
  'use strict';

  const TAG = '[LeetSync-AI][MonacoBridge]';

  function log(...args) {
    console.log(TAG, ...args);
  }

  function warn(...args) {
    console.warn(TAG, ...args);
  }

  function error(...args) {
    console.error(TAG, ...args);
  }

  log('Bridge script injected into page context.');

  /**
   * Attempt to extract user code from Monaco editor instances or models.
   * @returns {{ code: string, source: string } | null}
   */
  function tryExtractCode() {
    if (typeof window.monaco === 'undefined' || !window.monaco.editor) {
      log('window.monaco or window.monaco.editor is undefined.');
      return null;
    }

    log('window.monaco detected.');

    // Strategy 1: Check active editors
    try {
      if (typeof window.monaco.editor.getEditors === 'function') {
        const editors = window.monaco.editor.getEditors();
        log('Found editors count:', editors ? editors.length : 0);

        if (editors && editors.length > 0) {
          for (let i = 0; i < editors.length; i++) {
            const ed = editors[i];
            if (!ed) continue;
            try {
              const val = ed.getValue();
              if (typeof val === 'string' && val.trim().length > 0) {
                log(`Successfully extracted code from editor index ${i} (${val.length} chars).`);
                return { code: val, source: `editor[${i}]` };
              }
            } catch (edErr) {
              warn(`Error reading value from editor index ${i}:`, edErr);
            }
          }
        }
      }
    } catch (e) {
      warn('Error calling monaco.editor.getEditors():', e);
    }

    // Strategy 2: Check models (ITextModel[])
    try {
      if (typeof window.monaco.editor.getModels === 'function') {
        const models = window.monaco.editor.getModels();
        log('Found models count:', models ? models.length : 0);

        if (models && models.length > 0) {
          let bestModel = null;
          let bestLength = 0;

          for (let i = 0; i < models.length; i++) {
            const model = models[i];
            if (!model || typeof model.getValue !== 'function') continue;
            try {
              const val = model.getValue();
              const lang = typeof model.getLanguageId === 'function' ? model.getLanguageId() : 'unknown';
              const uri = model.uri ? model.uri.toString() : '';
              log(`Model index ${i}: uri="${uri}", language="${lang}", length=${val ? val.length : 0}`);

              if (typeof val === 'string' && val.trim().length > 0) {
                if (val.length > bestLength) {
                  bestLength = val.length;
                  bestModel = { code: val, source: `model[${i}] (${lang})` };
                }
              }
            } catch (modErr) {
              warn(`Error reading value from model index ${i}:`, modErr);
            }
          }

          if (bestModel) {
            log(`Successfully extracted code from best model: ${bestModel.source} (${bestModel.code.length} chars).`);
            return bestModel;
          }
        }
      }
    } catch (e) {
      warn('Error calling monaco.editor.getModels():', e);
    }

    return null;
  }

  /**
   * Run extraction with retry loop (polling every 100ms up to max 2000ms).
   */
  const startTime = Date.now();
  const MAX_WAIT_MS = 2000;
  const POLL_INTERVAL_MS = 100;

  function pollAndPost() {
    try {
      const result = tryExtractCode();
      if (result && typeof result.code === 'string') {
        log(`Posting success response via postMessage (length: ${result.code.length}, source: ${result.source}).`);
        window.postMessage({
          type: 'LEETSYNC_MONACO_CODE_RESPONSE',
          code: result.code,
          extractionSource: result.source
        }, '*');
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < MAX_WAIT_MS) {
        setTimeout(pollAndPost, POLL_INTERVAL_MS);
        return;
      }

      log(`Extraction timed out inside bridge after ${elapsed}ms. Posting code: null.`);
    } catch (err) {
      error('Unexpected exception during Monaco bridge polling:', err);
    }

    window.postMessage({ type: 'LEETSYNC_MONACO_CODE_RESPONSE', code: null }, '*');
  }

  pollAndPost();
})();
