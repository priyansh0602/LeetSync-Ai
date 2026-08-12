// content-script.js
// =============================================================================
// DOM Scraper — detects Accepted submissions and extracts problem/code data.
// Implemented in Phase 1.
//
// This script is injected on https://leetcode.com/* pages. It:
//   1. Sets up a MutationObserver to watch for submission results
//   2. Detects when the result is "Accepted" (ignoring all other verdicts)
//   3. Delegates data extraction to LeetSyncScraper (modules/scraper.js)
//   4. Sends the extracted data to background.js via chrome.runtime.sendMessage
//
// modules/scraper.js is loaded before this file via the manifest content_scripts
// array, so LeetSyncScraper is available as a global.
// =============================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants & Settings
  // ---------------------------------------------------------------------------

  /** Cooldown period (ms) — ignore repeated triggers for the same problem+language */
  const COOLDOWN_MS = 5000;

  /** Debug flag — set to true for detailed console logging */
  const DEBUG = true;

  /** Verdicts that are NOT accepted — used to explicitly exclude false positives */
  const REJECTED_VERDICTS = [
    'wrong answer',
    'runtime error',
    'time limit exceeded',
    'memory limit exceeded',
    'output limit exceeded',
    'compile error',
    'internal error',
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /**
   * Map of "problemSlug|language" → last-trigger timestamp.
   * Used for the in-page cooldown guard to prevent duplicate extractions.
   * @type {Map<string, number>}
   */
  /** Map of "problemSlug|language" → last-trigger timestamp */
  const recentTriggers = new Map();

  /** Flag to prevent overlapping extractions */
  let isExtracting = false;

  /**
   * Arming flag — true ONLY after user clicks Submit button for a pending submission.
   * Reset to false after extraction or submission timeout.
   */
  let isSubmissionArmed = false;

  /**
   * Baseline state flag — true if an "Accepted" verdict text was present on page load / route navigation.
   */
  let hadAcceptedOnLoad = false;

  // ---------------------------------------------------------------------------
  // Logging Helper
  // ---------------------------------------------------------------------------

  function debugLog(...args) {
    if (DEBUG) {
      console.log('[LeetSync-AI][DEBUG]', ...args);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit Button Listener & Arming Logic
  // ---------------------------------------------------------------------------

  function armSubmission() {
    isSubmissionArmed = true;
    hadAcceptedOnLoad = false; // Reset initial baseline state on new submission
    debugLog('Submission armed via Submit button click.');
    
    // Auto-disarm after 30 seconds if no verdict arrives
    setTimeout(function () {
      if (isSubmissionArmed) {
        isSubmissionArmed = false;
        debugLog('Submission disarmed due to timeout (30s).');
      }
    }, 30000);

    // Also trigger polling fallback specifically for this armed submission
    startPollingFallback();
  }

  /**
   * Global click listener to catch clicks on LeetCode's Submit button.
   */
  function setupSubmitButtonListener() {
    document.addEventListener('click', function (e) {
      const target = e.target;
      if (!target) return;

      // Find closest button or element with submit data attributes / text content
      const submitBtn = target.closest(
        'button[data-e2e-locator="console-submit-button"], ' +
        'button[class*="submit"], ' +
        'button:has(span)'
      ) || target.closest('button');

      if (submitBtn) {
        const text = submitBtn.textContent.trim().toLowerCase();
        if (text.includes('submit')) {
          armSubmission();
        }
      }
    }, true); // Capturing phase to catch click before LeetCode stops propagation
  }

  // ---------------------------------------------------------------------------
  // Baseline Scan
  // ---------------------------------------------------------------------------

  function recordInitialBaseline() {
    const observeRoot = document.getElementById('__next') || document.body;
    hadAcceptedOnLoad = containsAcceptedVerdict(observeRoot);
    isSubmissionArmed = false; // Ensure un-armed on initial page load
    debugLog('Initial baseline scan complete. hadAcceptedOnLoad =', hadAcceptedOnLoad);
  }

  // ---------------------------------------------------------------------------
  // Cooldown guard
  // ---------------------------------------------------------------------------

  /**
   * Build a cooldown key from the current page URL and language.
   * @param {string|null} language
   * @returns {string}
   */
  function getCooldownKey(language) {
    // Use the problem slug from the URL as part of the key
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    const slug = match ? match[1] : window.location.pathname;
    return slug + '|' + (language || 'unknown');
  }

  /**
   * Check if we're within the cooldown window for a given key.
   * @param {string} key
   * @returns {boolean} true if cooldown is active (should skip)
   */
  function isCooldownActive(key) {
    const lastTime = recentTriggers.get(key);
    if (!lastTime) return false;
    return (Date.now() - lastTime) < COOLDOWN_MS;
  }

  /**
   * Record a trigger for cooldown tracking.
   * @param {string} key
   */
  function recordTrigger(key) {
    recentTriggers.set(key, Date.now());
  }

  // ---------------------------------------------------------------------------
  // Accepted detection
  // ---------------------------------------------------------------------------

  /**
   * Check if a DOM element or its descendants contain an "Accepted" verdict.
   *
   * Strategy: look for text content that says "Accepted" while making sure
   * it's not one of the other verdicts. We also look for specific
   * known UI indicators (green success styling, data attributes, etc.).
   *
   * @param {Element} root - The element (or subtree) to inspect.
   * @returns {boolean}
   */
  function containsAcceptedVerdict(root) {
    try {
      if (!root || root.nodeType !== Node.ELEMENT_NODE) return false;

      // Strategy 1: Look for a result element with "Accepted" text
      const candidates = root.querySelectorAll(
        '[data-e2e-locator="submission-result"], ' +
        '[class*="result_"], [class*="Result"], ' +
        '[class*="status_"], [class*="Status"], ' +
        '[class*="accepted"], [class*="Accepted"], ' +
        '[class*="success"]'
      );

      for (const el of candidates) {
        const text = el.textContent.trim().toLowerCase();
        if (text.includes('accepted') && !isRejectedVerdict(text)) {
          debugLog('containsAcceptedVerdict matched via Strategy 1 (Candidate element):', el, 'Text:', text);
          return true;
        }
      }

      // Strategy 2: Broader text scan — look for the word "Accepted"
      const allElements = root.querySelectorAll('span, div, p');
      for (const el of allElements) {
        const text = el.textContent.trim();

        // Check if inside description panel
        const descPanel = el.closest(
          '[data-track-load="description_content"], ' +
          'div[class*="question-content"], ' +
          'div[class*="description"]'
        );
        if (descPanel) continue;

        // Exact match for "Accepted"
        if (text.length < 50 && /^accepted$/i.test(text)) {
          debugLog('containsAcceptedVerdict matched via Strategy 2 (Exact text "Accepted"):', el);
          return true;
        }
        // Match "Accepted" with runtime/stats (e.g., "Accepted — Runtime: 4ms")
        if (text.length < 200 && /^\s*accepted\b/i.test(text) && !isRejectedVerdict(text.toLowerCase())) {
          debugLog('containsAcceptedVerdict matched via Strategy 2 (Prefix text "Accepted..."):', el, 'Text:', text);
          return true;
        }
      }

      return false;
    } catch (err) {
      debugLog('Error in containsAcceptedVerdict:', err);
      return false;
    }
  }

  /**
   * Check if text corresponds to a rejected (non-Accepted) verdict.
   * @param {string} lowerText - Lowercased text to check.
   * @returns {boolean}
   */
  function isRejectedVerdict(lowerText) {
    return REJECTED_VERDICTS.some(function (v) { return lowerText.includes(v); });
  }

  // ---------------------------------------------------------------------------
  // Extraction + handoff
  // ---------------------------------------------------------------------------

  /**
   * Perform the full extraction and send the data to background.js.
   * Guarded by arming flag, baseline check, cooldown, and mutex.
   */
  async function handleAccepted() {
    console.log('[LeetSync-AI][DEBUG][handleAccepted ENTRY]', {
      isSubmissionArmed: isSubmissionArmed,
      hadAcceptedOnLoad: hadAcceptedOnLoad,
      isExtracting: isExtracting,
      pathname: window.location.pathname
    });

    // Gate 1: Arming check — must have clicked Submit
    if (!isSubmissionArmed) {
      debugLog('handleAccepted skipped: submission is not armed (no recent Submit button click)');
      return;
    }

    // Gate 2: Baseline check — skip if Accepted was already present on load
    if (hadAcceptedOnLoad) {
      debugLog('handleAccepted skipped: "Accepted" was already present on page load');
      return;
    }

    // Gate 3: Mutex check
    if (isExtracting) {
      debugLog('handleAccepted skipped: isExtracting mutex is true');
      return;
    }

    // Quick early cooldown check using problem slug from URL
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    const slug = match ? match[1] : window.location.pathname;
    const earlyKeyPrefix = slug + '|';
    
    // Check if any recent trigger matches this problem slug within cooldown window
    for (const [key, timestamp] of recentTriggers.entries()) {
      if (key.startsWith(earlyKeyPrefix) && (Date.now() - timestamp) < COOLDOWN_MS) {
        debugLog('handleAccepted skipped: early cooldown active for', key);
        return;
      }
    }

    isExtracting = true;
    isSubmissionArmed = false; // Disarm immediately upon starting extraction
    
    // Record a temporary trigger immediately to block duplicate async callers
    const tempKey = earlyKeyPrefix + 'pending';
    recordTrigger(tempKey);

    try {
      // Small delay to let LeetCode's UI fully settle after showing "Accepted"
      await new Promise(function (resolve) { setTimeout(resolve, 800); });

      // Check LeetSyncScraper is available (loaded from modules/scraper.js)
      if (typeof LeetSyncScraper === 'undefined') {
        console.error('[LeetSync-AI] LeetSyncScraper not loaded — cannot extract.');
        return;
      }

      // Extract all data
      const data = await LeetSyncScraper.extractAll();

      // Final cooldown check with extracted language key
      const cooldownKey = getCooldownKey(data.language);
      if (cooldownKey !== tempKey && isCooldownActive(cooldownKey)) {
        console.log('[LeetSync-AI] Cooldown active for', cooldownKey, '— skipping duplicate.');
        return;
      }
      recordTrigger(cooldownKey);

      // Log for manual verification
      console.log('[LeetSync-AI] Extracted:', data);

      // Send to background script
      try {
        chrome.runtime.sendMessage({
          type: 'SUBMISSION_ACCEPTED',
          payload: data,
        });
      } catch (msgError) {
        console.warn('[LeetSync-AI] sendMessage error (expected if background listener not yet implemented):', msgError.message);
      }

    } catch (err) {
      console.error('[LeetSync-AI] Extraction failed:', err);
    } finally {
      isExtracting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Polling Fallback
  // ---------------------------------------------------------------------------

  let pollingTimer = null;
  let pollingStartTime = 0;

  function startPollingFallback() {
    if (pollingTimer) clearInterval(pollingTimer);
    if (!isSubmissionArmed) {
      debugLog('Polling fallback not started: submission is not armed.');
      return;
    }

    pollingStartTime = Date.now();
    debugLog('Starting armed polling fallback for submission result...');

    pollingTimer = setInterval(function () {
      // Timeout after 15 seconds
      if (Date.now() - pollingStartTime > 15000) {
        debugLog('Polling fallback timed out after 15 seconds.');
        clearInterval(pollingTimer);
        pollingTimer = null;
        return;
      }

      if (!isSubmissionArmed) {
        clearInterval(pollingTimer);
        pollingTimer = null;
        return;
      }

      const observeRoot = document.getElementById('__next') || document.body;
      if (observeRoot && containsAcceptedVerdict(observeRoot)) {
        debugLog('Polling fallback detected Accepted verdict!');
        clearInterval(pollingTimer);
        pollingTimer = null;
        handleAccepted();
      }
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // MutationObserver setup
  // ---------------------------------------------------------------------------

  /**
   * Start observing the DOM for submission result changes.
   * Uses a MutationObserver on a broad but reasonable container.
   */
  function startObserver() {
    // Only activate on problem pages
    if (!window.location.pathname.includes('/problems/')) {
      return;
    }

    const observeRoot = document.getElementById('__next') || document.body;

    /** Debounce timer for mutation batches */
    let debounceTimer = null;

    const observer = new MutationObserver(function (mutations) {
      // Only process mutations if submission is armed
      if (!isSubmissionArmed) return;

      // Debug logging for mutations
      if (DEBUG) {
        debugLog(`Observer batch fired with ${mutations.length} mutations.`);
        for (const m of mutations) {
          if (m.type === 'childList' && m.addedNodes.length > 0) {
            for (const node of m.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const textSnippet = (node.textContent || '').trim().substring(0, 100);
                debugLog(`Added Element <${node.tagName.toLowerCase()} class="${node.className}">: "${textSnippet}"`);
              }
            }
          } else if (m.type === 'characterData') {
            const textSnippet = (m.target.textContent || '').trim().substring(0, 100);
            debugLog(`characterData changed on parent <${m.target.parentElement ? m.target.parentElement.tagName.toLowerCase() : 'unknown'}>: "${textSnippet}"`);
          }
        }
      }

      // Debounce: batch rapid mutations into a single check
      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(function () {
        if (!isSubmissionArmed) return;

        // Direct mutation inspection check
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE && containsAcceptedVerdict(node)) {
                debugLog('Accepted verdict detected on newly added node!');
                handleAccepted();
                return;
              }
            }
          } else if (mutation.type === 'characterData') {
            const parent = mutation.target.parentElement;
            if (parent && containsAcceptedVerdict(parent)) {
              debugLog('Accepted verdict detected on characterData parent element!');
              handleAccepted();
              return;
            }
          }
        }

        // Broader DOM check across observeRoot
        if (containsAcceptedVerdict(observeRoot)) {
          debugLog('Accepted verdict detected via broader root scan!');
          handleAccepted();
        }
      }, 300); // 300ms debounce
    });

    observer.observe(observeRoot, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log('[LeetSync-AI] MutationObserver active — watching for Accepted submissions.');
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function init() {
    setupSubmitButtonListener();
    recordInitialBaseline();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  let lastPathname = window.location.pathname;
  setInterval(function () {
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname;
      if (window.location.pathname.includes('/problems/')) {
        console.log('[LeetSync-AI] SPA navigation detected:', window.location.pathname);
        recordInitialBaseline(); // Record baseline on route change
      }
    }
  }, 2000);

})();
