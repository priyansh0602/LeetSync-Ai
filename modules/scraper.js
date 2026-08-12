// modules/scraper.js
// =============================================================================
// Core scraping logic used by content-script.js — implemented in Phase 1.
//
// Extracts problem metadata, user code, and test cases from LeetCode's DOM.
// Uses multiple fallback selectors for resilience against UI changes.
// Does NOT modify, trim, or reformat the user's code in any way.
// =============================================================================

/**
 * @namespace LeetSyncScraper
 * All scraping logic is namespaced here to avoid polluting the global scope
 * and to allow content-script.js to call it cleanly.
 */
// eslint-disable-next-line no-var
var LeetSyncScraper = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // DEBUG FLAG — set to true to bypass Monaco bridge and force DOM fallback
  // extraction. This is for testing the blank-line-reconstruction fix.
  // REVERT TO false BEFORE SHIPPING.
  // ---------------------------------------------------------------------------
  const FORCE_DOM_FALLBACK = false;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Try multiple CSS selectors in order, return the first element found or null.
   * @param {string[]} selectors - CSS selectors to try.
   * @param {Element} [root=document] - Root element to query within.
   * @returns {Element|null}
   */
  function queryFirst(selectors, root) {
    const base = root || document;
    for (const sel of selectors) {
      try {
        const el = base.querySelector(sel);
        if (el) return el;
      } catch (_) {
        // Invalid selector — skip silently
      }
    }
    return null;
  }

  /**
   * Try multiple CSS selectors in order, return all elements found.
   * @param {string[]} selectors
   * @param {Element} [root=document]
   * @returns {Element[]}
   */
  function queryAll(selectors, root) {
    const base = root || document;
    for (const sel of selectors) {
      try {
        const els = base.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      } catch (_) {
        // Invalid selector — skip silently
      }
    }
    return [];
  }

  /**
   * Build the canonical problem URL from the current page location.
   * Strips query params, fragments, and trailing submission/solution paths.
   * Keeps: https://leetcode.com/problems/<slug>/
   * @returns {string}
   */
  function getCanonicalProblemUrl() {
    try {
      const url = new URL(window.location.href);
      // Extract up to and including the problem slug
      const match = url.pathname.match(/^(\/problems\/[^/]+)\/?/);
      if (match) {
        return url.origin + match[1] + '/';
      }
      // Fallback: return cleaned href without query/hash
      return url.origin + url.pathname;
    } catch (_) {
      return window.location.href;
    }
  }

  // ---------------------------------------------------------------------------
  // Individual field extractors — each wrapped in try/catch
  // ---------------------------------------------------------------------------

  /**
   * Extract the problem title text.
   * Uses multiple DOM selectors, document.title fallback, and URL slug formatting fallback.
   * @returns {string|null}
   */
  function extractProblemTitle() {
    try {
      // Primary: DOM selectors for LeetCode title elements across UI versions
      const el = queryFirst([
        '[data-cy="question-title"]',
        'h4[data-cy="question-title"]',
        'div[class*="text-title-large"] a',
        'div[class*="text-title-large"]',
        'a[class*="text-label-r"]',               // new-ish UI: problem title link
        'div[data-track-load="description_content"] a',
        '#qd-content h4 a',                        // explore-section variant
        'div.flexlayout__tab_header_content',       // tab header fallback
        'div[class*="title"] a',
        'span[class*="title"]',
      ]);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
      }

      // Secondary: look for the first link whose href contains /problems/ inside description
      const links = document.querySelectorAll('a[href*="/problems/"]');
      for (const link of links) {
        const t = link.textContent.trim();
        if (t && /^\d+\.\s/.test(t)) return t;
      }

      // Fallback 1: Extract from document.title (e.g. "1. Two Sum - LeetCode")
      if (typeof document !== 'undefined' && document.title) {
        const parts = document.title.split(/[-|]\s*LeetCode/i);
        if (parts.length > 0) {
          const cleanTitle = parts[0].trim();
          if (cleanTitle && !/problems|leetcode/i.test(cleanTitle)) {
            return cleanTitle;
          }
        }
      }

      // Fallback 2: Format from canonical URL slug (e.g. /problems/two-sum/ -> "Two Sum")
      const canonicalUrl = getCanonicalProblemUrl();
      const match = canonicalUrl.match(/\/problems\/([^/#?]+)/);
      if (match && match[1]) {
        const rawSlug = match[1];
        return rawSlug
          .split('-')
          .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
          .join(' ');
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Extract the difficulty label (Easy / Medium / Hard).
   * @returns {string|null}
   */
  function extractDifficulty() {
    try {
      // Strategy 1: Tag-agnostic CSS selectors with case-insensitive modifier
      const el = queryFirst([
        '[class*="text-difficulty-easy" i]',
        '[class*="text-difficulty-medium" i]',
        '[class*="text-difficulty-hard" i]',
        '[class*="text-sd-easy" i]',
        '[class*="text-sd-medium" i]',
        '[class*="text-sd-hard" i]',
        '[class*="text-badge-easy" i]',
        '[class*="text-badge-medium" i]',
        '[class*="text-badge-hard" i]',
        '[class*="text-fill-easy" i]',
        '[class*="text-fill-medium" i]',
        '[class*="text-fill-hard" i]',
        '[class*="difficulty-easy" i]',
        '[class*="difficulty-medium" i]',
        '[class*="difficulty-hard" i]',
        '[class*="text-easy" i]',
        '[class*="text-medium" i]',
        '[class*="text-hard" i]',
        '[class*="text-olive" i]',
        '[class*="text-yellow" i]',
        '[class*="text-pink" i]',
        '[class*="text-teal" i]',
        '[class*="text-green" i]',
        '[class*="text-red" i]',
        '[data-degree]',
        '[data-difficulty]',
        '[diff]',
      ]);
      if (el) {
        const text = (el.textContent || '').trim();
        let matched = null;
        if (/easy/i.test(text)) matched = 'Easy';
        else if (/medium/i.test(text)) matched = 'Medium';
        else if (/hard/i.test(text)) matched = 'Hard';
        else if (text && /^(Easy|Medium|Hard)$/i.test(text)) {
          matched = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
        }
        if (matched) {
          console.log(`[LeetSync-AI][DEBUG] extractDifficulty: Primary selector matched element <${el.tagName.toLowerCase()} class="${el.className}"> with text '${text}' => '${matched}'`);
          return matched;
        }
      }

      // Strategy 2: Embedded Next.js script data (__NEXT_DATA__ or application/json script tags)
      try {
        const scripts = document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__, script[id*="next"]');
        for (const script of scripts) {
          if (script.textContent) {
            const match = script.textContent.match(/"difficulty"\s*:\s*"(Easy|Medium|Hard)"/i);
            if (match && match[1]) {
              const diff = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
              console.log(`[LeetSync-AI][DEBUG] extractDifficulty: Script JSON fallback matched difficulty '${diff}' from script tag (#${script.id || 'anonymous'})`);
              return diff;
            }
          }
        }
      } catch (scriptErr) {
        // Skip script parsing failure
      }

      // Strategy 3: Candidate scan for elements with difficulty-related class names
      const candidates = document.querySelectorAll(
        '[class*="difficulty" i], [class*="Difficulty" i], [class*="badge" i], [class*="Badge" i], [class*="label" i], [class*="sd-" i]'
      );
      for (const c of candidates) {
        const t = (c.innerText || c.textContent || '').trim();
        if (/^(Easy|Medium|Hard)$/i.test(t)) {
          const diff = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
          console.log(`[LeetSync-AI][DEBUG] extractDifficulty: Candidate class scan matched element <${c.tagName.toLowerCase()} class="${c.className}"> with text '${t}' => '${diff}'`);
          return diff;
        }
      }

      // Strategy 4: Direct text scan of leaf elements
      const allLeafs = document.querySelectorAll('span, div, p, a, button');
      for (const s of allLeafs) {
        const t = (s.innerText || s.textContent || '').trim();
        if (/^(Easy|Medium|Hard)$/i.test(t) && (!s.children || s.children.length <= 1)) {
          const diff = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
          console.log(`[LeetSync-AI][DEBUG] extractDifficulty: Direct leaf text scan matched element <${s.tagName.toLowerCase()} class="${s.className}"> with text '${t}' => '${diff}'`);
          return diff;
        }
      }

      console.log('[LeetSync-AI][DEBUG] extractDifficulty: All 4 extraction strategies failed (primary selectors, script JSON, candidate scan, leaf text scan). Returning null.');
      return null;
    } catch (err) {
      console.warn('[LeetSync-AI][DEBUG] extractDifficulty encountered error:', err);
      return null;
    }
  }

  /**
   * Extract the selected language label exactly as LeetCode displays it.
   * @returns {string|null}
   */
  function extractLanguage() {
    try {
      // The language selector is typically a button or dropdown showing the
      // currently selected language.
      const el = queryFirst([
        'button[id*="lang"] span',                     // newer dropdown button
        'div[class*="lang-btn"] span',
        'button[class*="lang-select"]',
        'div[data-cy="lang-select"] .ant-select-selection-selected-value',
        '.ant-select-selection-selected-value',
        'button[class*="rounded"][class*="items-center"] span.text-label-r', // new UI variant
      ]);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
      }

      // Broader heuristic: look for a button near the editor whose text matches
      // a known language name pattern
      const buttons = document.querySelectorAll('button');
      const langPattern = /^(C\+\+|Java|Python|Python3|JavaScript|TypeScript|C#|C|Go|Ruby|Swift|Kotlin|Rust|Scala|PHP|Racket|Erlang|Elixir|Dart|MySQL|MS SQL Server|Oracle|Pandas|PostgreSQL|R)$/i;
      for (const btn of buttons) {
        const t = btn.textContent.trim();
        if (langPattern.test(t)) return t;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Extract the full problem description text.
   * @returns {string|null}
   */
  function extractDescription() {
    try {
      const el = queryFirst([
        'div[data-track-load="description_content"]',
        'div[class*="elfjS"]',                        // common new-UI wrapper class
        'div.question-content__JfgR',                 // V1 UI
        'div[class*="question-content"]',
        'div[class*="_description_"]',                // another variant
        'div[class*="content__u3I1"]',
      ]);
      if (el) {
        return el.textContent || null;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Extract sample test cases / example blocks from the problem description.
   * Returns raw text of all example blocks concatenated.
   * @returns {string|null}
   */
  function extractTestCases() {
    try {
      // LeetCode wraps examples in <pre> tags or divs with "example" in class
      const descEl = queryFirst([
        'div[data-track-load="description_content"]',
        'div[class*="elfjS"]',
        'div.question-content__JfgR',
        'div[class*="question-content"]',
      ]);
      if (!descEl) return null;

      // Approach 1: grab all <pre> tags inside description (examples are in <pre>)
      const pres = descEl.querySelectorAll('pre');
      if (pres.length > 0) {
        const parts = [];
        for (const pre of pres) {
          const text = pre.textContent;
          if (text) parts.push(text);
        }
        if (parts.length > 0) return parts.join('\n\n');
      }

      // Approach 2: look for elements labelled "Example"
      const examples = descEl.querySelectorAll('div[class*="example"], strong');
      const blocks = [];
      for (const ex of examples) {
        if (/example/i.test(ex.textContent)) {
          // Grab the parent or next sibling content
          const parent = ex.closest('div') || ex.parentElement;
          if (parent) blocks.push(parent.textContent);
        }
      }
      if (blocks.length > 0) return blocks.join('\n\n');

      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Extract the user's code from the Monaco editor.
   *
   * CRITICAL: This must return the code EXACTLY as it exists in the editor.
   * No trimming of logic, no whitespace mangling, no reformatting.
   *
   * Strategy:
   *   1. (Primary) Inject a tiny script into the page context to call
   *      monaco.editor.getEditors()[0].getValue() — this is the most
   *      faithful extraction method.
   *   2. (Fallback) Read the DOM text content of the Monaco editor lines.
   *
   * Returns a Promise that resolves to the code string.
   *
   * @returns {Promise<string|null>}
   */
  function extractUserCode() {
    // DEBUG: Force DOM fallback path when flag is set
    if (FORCE_DOM_FALLBACK) {
      console.warn('[LeetSync-AI] FORCE_DOM_FALLBACK is ON — skipping Monaco bridge, using DOM extraction directly.');
      return Promise.resolve(extractUserCodeFromDOM());
    }

    return new Promise(function (resolve) {
      const timeout = setTimeout(function () {
        window.removeEventListener('message', onMessage);
        if (script.parentNode) script.remove();
        console.warn('[LeetSync-AI] Monaco bridge timed out, falling back to DOM extraction');
        resolve(extractUserCodeFromDOM());
      }, 3000);

      function onMessage(event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'LEETSYNC_MONACO_CODE_RESPONSE') {
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          if (script.parentNode) script.remove();
          if (typeof event.data.code === 'string') {
            console.log('[LeetSync-AI] Successfully extracted code via Monaco bridge (' + event.data.code.length + ' chars, source: ' + (event.data.extractionSource || 'bridge') + ')');
            resolve(event.data.code);
          } else {
            resolve(extractUserCodeFromDOM());
          }
        }
      }

      window.addEventListener('message', onMessage);

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('modules/monaco-bridge.js');
      (document.head || document.documentElement).appendChild(script);
    });
  }

  /**
   * Fallback: extract code from the Monaco editor DOM.
   * Less reliable than the model API but works when the bridge fails.
   *
   * CRITICAL: We read each line's textContent and join with '\n'.
   * We do NOT trim or modify any line content.
   *
   * @returns {string|null}
   */
  function extractUserCodeFromDOM() {
    try {
      // 1. Find all .view-lines containers on the page to isolate main code editor
      const rawContainers = Array.from(document.querySelectorAll('.view-lines'));
      console.log(`[LeetSync-AI][DOM-Extract] Found ${rawContainers.length} .view-lines container(s) on page.`);

      let targetContainer = null;
      let maxLinesCount = 0;

      rawContainers.forEach((container, idx) => {
        const linesCount = container.querySelectorAll('.view-line').length;
        const parentClass = container.parentElement ? container.parentElement.className : 'unknown';
        const sampleText = container.querySelector('.view-line') ? container.querySelector('.view-line').textContent.slice(0, 40) : '(empty)';

        console.log(`[LeetSync-AI][DOM-Extract] Container #${idx}: ${linesCount} .view-line(s) | Parent class: "${parentClass}" | Sample: "${sampleText}"`);

        if (linesCount > maxLinesCount) {
          maxLinesCount = linesCount;
          targetContainer = container;
        }
      });

      const lines = targetContainer ? Array.from(targetContainer.querySelectorAll('.view-line')) : queryAll([
        '.monaco-editor .view-lines .view-line',
        '.view-lines .view-line',
      ]);

      console.log(`[LeetSync-AI][DOM-Extract] Selected container with ${lines.length} raw .view-line elements.`);

      if (lines.length > 0) {
        // Monaco may not render lines in DOM order — sort by top offset
        const sorted = lines.slice().sort(function (a, b) {
          const topA = parseFloat(a.style.top) || 0;
          const topB = parseFloat(b.style.top) || 0;
          return topA - topB;
        });

        console.log(`[LeetSync-AI][DOM-Extract] Sorted ${sorted.length} lines. First top: ${sorted[0].style.top}, Last top: ${sorted[sorted.length - 1].style.top}`);

        // Estimate line height from adjacent lines (typically 18px-24px in Monaco)
        let estimatedLineHeight = 18;
        for (let i = 0; i < sorted.length - 1; i++) {
          const t1 = parseFloat(sorted[i].style.top) || 0;
          const t2 = parseFloat(sorted[i + 1].style.top) || 0;
          const diff = Math.round(t2 - t1);
          if (diff >= 14 && diff <= 32) {
            estimatedLineHeight = diff;
            break;
          }
        }

        console.log(`[LeetSync-AI][DOM-Extract] Estimated line height: ${estimatedLineHeight}px.`);

        const resultLines = [];
        let lastTop = -1;

        for (let i = 0; i < sorted.length; i++) {
          const currentTop = Math.round(parseFloat(sorted[i].style.top) || 0);
          if (lastTop !== -1 && estimatedLineHeight > 0) {
            const gap = currentTop - lastTop;
            if (gap > estimatedLineHeight * 1.4) {
              const missingLines = Math.round(gap / estimatedLineHeight) - 1;
              const safeMissing = Math.min(missingLines, 20); // allow up to 20 consecutive blank lines
              console.log(`[LeetSync-AI][DOM-Extract] Gap detected between top ${lastTop}px and ${currentTop}px (${gap}px, ~${missingLines} lines). Inserting ${safeMissing} blank line(s).`);
              for (let m = 0; m < safeMissing; m++) {
                resultLines.push('');
              }
            }
          }
          resultLines.push(sorted[i].textContent || '');
          lastTop = currentTop;
        }

        console.log(`[LeetSync-AI][DOM-Extract] Reconstructed resultLines count before trimming: ${resultLines.length}`);

        // Trim leading and trailing blank lines to avoid phantom top/bottom lines
        while (resultLines.length > 0 && resultLines[0].trim() === '') {
          resultLines.shift();
        }
        while (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() === '') {
          resultLines.pop();
        }

        const code = resultLines.join('\n');
        console.log(`[LeetSync-AI][DOM-Extract] FINAL Extracted code: ${resultLines.length} lines (${code.length} chars, blank lines: ${(code.match(/\n[ \t]*\n/g) || []).length}).`);

        // DOM Fallback Safety Warning: Monaco uses virtual scrolling for performance,
        // so DOM extraction only captures lines currently rendered in the viewport.
        console.warn(
          `[LeetSync-AI][WARNING] DOM fallback extraction was used instead of Monaco bridge. ` +
          `Extracted ${resultLines.length} lines (${code.length} chars). ` +
          `NOTE: Monaco editor virtualizes off-screen lines, so DOM extraction may be incomplete for longer solutions exceeding the visible viewport.`
        );

        if (resultLines.length < 25 || code.length < 300) {
          console.warn(
            `[LeetSync-AI][WARNING] DOM fallback result appears short (${resultLines.length} lines, ${code.length} chars). ` +
            `If the full solution had off-screen lines outside the viewport, they were not rendered in DOM and could not be captured.`
          );
        }

        return code;
      }

      // Final fallback: grab any code-like container
      const codeEl = queryFirst([
        '.monaco-editor .lines-content',
        '.monaco-editor',
      ]);
      if (codeEl) {
        return codeEl.textContent || null;
      }
      return null;
    } catch (err) {
      console.warn('[LeetSync-AI] Error in extractUserCodeFromDOM:', err);
      return null;
    }
  }

  /**
   * Polls DOM for missing metadata fields (problemTitle, difficulty).
   * Retries up to maxRetries times with intervalMs delay.
   * Logs attempt details at each interval for diagnostics.
   * @param {Object} data
   * @param {number} maxRetries
   * @param {number} intervalMs
   * @returns {Promise<void>}
   */
  async function retryMissingMetadata(data, maxRetries = 10, intervalMs = 300) {
    const missing = [];
    if (!data.problemTitle) missing.push('problemTitle');
    if (!data.difficulty) missing.push('difficulty');
    
    console.log(`[LeetSync-AI][DEBUG] retryMissingMetadata: Starting retry loop for missing fields: [${missing.join(', ')}] (maxRetries: ${maxRetries}, interval: ${intervalMs}ms)`);

    for (let i = 0; i < maxRetries; i++) {
      const needsTitle = !data.problemTitle;
      const needsDifficulty = !data.difficulty;
      if (!needsTitle && !needsDifficulty) {
        console.log(`[LeetSync-AI][DEBUG] retryMissingMetadata: All missing fields acquired prior to retry iteration ${i + 1}.`);
        break;
      }

      console.log(`[LeetSync-AI][DEBUG] retryMissingMetadata: Iteration ${i + 1}/${maxRetries} (Needs Title: ${needsTitle}, Needs Difficulty: ${needsDifficulty})...`);

      if (needsTitle) {
        try {
          data.problemTitle = extractProblemTitle();
          console.log(`[LeetSync-AI][DEBUG] retryMissingMetadata iteration ${i + 1}: extractProblemTitle returned -> '${data.problemTitle}'`);
        } catch (err) {
          console.warn(`[LeetSync-AI][DEBUG] retryMissingMetadata iteration ${i + 1}: extractProblemTitle error:`, err);
        }
      }
      if (needsDifficulty) {
        try {
          data.difficulty = extractDifficulty();
          console.log(`[LeetSync-AI][DEBUG] retryMissingMetadata iteration ${i + 1}: extractDifficulty returned -> '${data.difficulty}'`);
        } catch (err) {
          console.warn(`[LeetSync-AI][DEBUG] retryMissingMetadata iteration ${i + 1}: extractDifficulty error:`, err);
        }
      }

      if (data.problemTitle && data.difficulty) {
        console.log(`[LeetSync-AI][DEBUG] retryMissingMetadata: Successfully resolved all fields on iteration ${i + 1}/${maxRetries}. Title: '${data.problemTitle}', Difficulty: '${data.difficulty}'`);
        break;
      }

      if (i < maxRetries - 1) {
        await new Promise(function (resolve) { setTimeout(resolve, intervalMs); });
      }
    }

    if (!data.problemTitle || !data.difficulty) {
      console.warn(`[LeetSync-AI][DEBUG] retryMissingMetadata finished after ${maxRetries} iterations. Final metadata status -> Title: '${data.problemTitle}', Difficulty: '${data.difficulty}'`);
    }
  }

  // ---------------------------------------------------------------------------
  // Main extraction orchestrator
  // ---------------------------------------------------------------------------

  /**
   * Run all extractors and build the data object.
   * @returns {Promise<Object>} The extracted data object.
   */
  async function extractAll() {
    const data = {
      problemTitle: null,
      problemUrl: null,
      difficulty: null,
      language: null,
      userCode: null,
      description: null,
      testCases: null,
      timestamp: Date.now(),
    };

    // Each field extracted independently — one failure doesn't block others
    try { data.problemTitle = extractProblemTitle(); } catch (_) { /* null */ }
    try { data.problemUrl = getCanonicalProblemUrl(); } catch (_) { /* null */ }
    try { data.difficulty = extractDifficulty(); } catch (_) { /* null */ }
    try { data.language = extractLanguage(); } catch (_) { /* null */ }
    try { data.description = extractDescription(); } catch (_) { /* null */ }
    try { data.testCases = extractTestCases(); } catch (_) { /* null */ }

    // If title or difficulty are missing (e.g. right after page refresh), poll DOM
    if (!data.problemTitle || !data.difficulty) {
      await retryMissingMetadata(data, 10, 300);
    }

    // Code extraction is async (bridge injection)
    try {
      data.userCode = await extractUserCode();
    } catch (_) {
      // If even the async wrapper fails, try synchronous DOM fallback
      try { data.userCode = extractUserCodeFromDOM(); } catch (__) { /* null */ }
    }

    return data;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    extractAll: extractAll,
    // Exposed for testing individual extractors if needed
    _extractProblemTitle: extractProblemTitle,
    _extractDifficulty: extractDifficulty,
    _extractLanguage: extractLanguage,
    _extractDescription: extractDescription,
    _extractTestCases: extractTestCases,
    _extractUserCode: extractUserCode,
    _extractUserCodeFromDOM: extractUserCodeFromDOM,
    _getCanonicalProblemUrl: getCanonicalProblemUrl,
  };
})();
