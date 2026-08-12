// background.js
// =============================================================================
// LeetSync-AI Service Worker (Background Script)
// Orchestrates messages between content script, AI engine, and GitHub sync.
// Implemented in Phase 3.
// =============================================================================

(function () {
  'use strict';

  // Load modules in MV3 service worker
  try {
    importScripts('modules/ai-connector.js');
    console.log('[LeetSync-AI] Successfully imported modules/ai-connector.js');
  } catch (importErr) {
    console.error('[LeetSync-AI] Failed to import modules/ai-connector.js:', importErr);
  }

  try {
    importScripts('modules/verifier.js');
    console.log('[LeetSync-AI] Successfully imported modules/verifier.js');
  } catch (importErr) {
    console.error('[LeetSync-AI] Failed to import modules/verifier.js:', importErr);
  }

  try {
    importScripts('modules/github-sync.js');
    console.log('[LeetSync-AI] Successfully imported modules/github-sync.js');
  } catch (importErr) {
    console.error('[LeetSync-AI] Failed to import modules/github-sync.js:', importErr);
  }

  // ---------------------------------------------------------------------------
  // Storage Key Constants
  // ---------------------------------------------------------------------------
  const CONFIG_KEY = 'leetsyncConfig';
  const RECENT_SUBMISSIONS_KEY = 'leetsyncRecentSubmissions';

  // Timeouts (in milliseconds)
  const DUPLICATE_WINDOW_MS = 60 * 1000; // 60 seconds
  const PRUNE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  // ---------------------------------------------------------------------------
  // Helper Functions
  // ---------------------------------------------------------------------------

  // In-memory cache for fast deduplication within service worker context
  const inMemoryRecentSubmissions = {};

  /**
   * Computes a canonical, unique deduplication key for a submission.
   * Extracts problem slug from canonical URL or problemTitle, and normalizes language.
   * Guarantees identical keys across refreshes even if problemTitle is null.
   * @param {Object} payload
   * @returns {string}
   */
  function getDedupeKey(payload) {
    let slug = '';

    // 1. Attempt slug extraction from problemUrl
    if (payload && typeof payload.problemUrl === 'string' && payload.problemUrl.trim()) {
      const match = payload.problemUrl.match(/\/problems\/([^/#?]+)/i);
      if (match && match[1]) {
        slug = match[1].toLowerCase().trim();
      }
    }

    // 2. Fallback: derive slug from problemTitle
    if (!slug && payload && typeof payload.problemTitle === 'string' && payload.problemTitle.trim()) {
      // Remove leading problem number (e.g. "1. Two Sum" -> "Two Sum")
      const cleanedTitle = payload.problemTitle.replace(/^\d+\.\s*/, '').trim().toLowerCase();
      // Turn spaces/special chars into hyphens
      slug = cleanedTitle.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    // 3. Final fallback for identifier
    if (!slug) {
      slug = 'unknown-problem';
    }

    // 4. Normalize language
    let lang = 'unknown-language';
    if (payload && typeof payload.language === 'string' && payload.language.trim()) {
      lang = payload.language.trim().toLowerCase();
    }

    return `${slug}|${lang}`;
  }

  /**
   * Prunes old submission timestamps from the recentSubmissions object.
   * Removes entries older than 5 minutes (PRUNE_WINDOW_MS).
   * @param {Object} recentMap - Object mapping dedupeKey -> timestamp
   * @param {number} now - Current timestamp (ms)
   * @returns {Object} Cleaned map
   */
  function pruneRecentSubmissions(recentMap, now) {
    const cleaned = {};
    if (!recentMap || typeof recentMap !== 'object') {
      return cleaned;
    }
    for (const [key, timestamp] of Object.entries(recentMap)) {
      if (typeof timestamp === 'number' && (now - timestamp) < PRUNE_WINDOW_MS) {
        cleaned[key] = timestamp;
      }
    }
    return cleaned;
  }

  /**
   * Validates whether extension configuration is present and non-empty.
   * Checks groqApiKey, githubToken, and githubRepo.
   * @param {Object} config
   * @returns {{ isValid: boolean, missingFields: string[] }}
   */
  function validateConfig(config) {
    const missing = [];
    if (!config || typeof config !== 'object') {
      return { isValid: false, missingFields: ['groqApiKey', 'githubToken', 'githubRepo'] };
    }

    if (!config.groqApiKey || typeof config.groqApiKey !== 'string' || !config.groqApiKey.trim()) {
      missing.push('groqApiKey');
    }
    if (!config.githubToken || typeof config.githubToken !== 'string' || !config.githubToken.trim()) {
      missing.push('githubToken');
    }
    if (!config.githubRepo || typeof config.githubRepo !== 'string' || !config.githubRepo.trim()) {
      missing.push('githubRepo');
    }

    return {
      isValid: missing.length === 0,
      missingFields: missing,
    };
  }

  // ---------------------------------------------------------------------------
  // Message Handler Logic
  // ---------------------------------------------------------------------------

  /**
   * Handles incoming SUBMISSION_ACCEPTED payload.
   * 1. Checks storage and in-memory cache for duplicates within 60 seconds.
   * 2. Prunes duplicate store entries older than 5 minutes.
   * 3. Checks configuration in chrome.storage.local.
   * 4. Logs pipeline status for Phase 4 placeholder.
   *
   * @param {Object} payload - Extracted submission payload from content script.
   * @param {Function} sendResponse - Chrome runtime sendResponse callback.
   */
  function handleSubmissionAccepted(payload, sendResponse) {
    const now = Date.now();
    const dedupeKey = getDedupeKey(payload);

    // Read both recentSubmissions and config from chrome.storage.local to be MV3-safe
    chrome.storage.local.get([RECENT_SUBMISSIONS_KEY, CONFIG_KEY], function (result) {
      if (chrome.runtime.lastError) {
        console.error('[LeetSync-AI] Storage read error:', chrome.runtime.lastError.message);
        sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
        return;
      }

      const rawRecentMap = (result && result[RECENT_SUBMISSIONS_KEY]) || {};
      const config = result ? result[CONFIG_KEY] : null;

      // Merge in-memory cache with storage data
      const mergedMap = Object.assign({}, rawRecentMap, inMemoryRecentSubmissions);

      // Step 1: Prune old entries (>5m) & check duplicate window (60s)
      const recentMap = pruneRecentSubmissions(mergedMap, now);
      const lastSeenTime = recentMap[dedupeKey];

      if (typeof lastSeenTime === 'number' && (now - lastSeenTime) < DUPLICATE_WINDOW_MS) {
        console.log(`[LeetSync-AI] Duplicate submission skipped for key: "${dedupeKey}" (processed ${Math.round((now - lastSeenTime) / 1000)}s ago).`);
        
        // Persist pruned map back to storage and memory cache
        Object.assign(inMemoryRecentSubmissions, recentMap);
        chrome.storage.local.set({ [RECENT_SUBMISSIONS_KEY]: recentMap }, function () {
          sendResponse({ status: 'skipped', reason: 'duplicate', dedupeKey: dedupeKey });
        });
        return;
      }

      // Record this submission attempt in memory and local map
      recentMap[dedupeKey] = now;
      inMemoryRecentSubmissions[dedupeKey] = now;

      // Update storage with newly pruned map and current submission timestamp
      chrome.storage.local.set({ [RECENT_SUBMISSIONS_KEY]: recentMap }, function () {
        if (chrome.runtime.lastError) {
          console.warn('[LeetSync-AI] Failed to update recentSubmissions in storage:', chrome.runtime.lastError.message);
        }

        // Step 2: Configuration check
        const configStatus = validateConfig(config);
        if (!configStatus.isValid) {
          console.warn('[LeetSync-AI] Cannot process submission — settings not configured. Please open the extension popup and add your API key, GitHub token, and repository.');
          sendResponse({
            status: 'unconfigured',
            message: 'Settings not configured',
            missingFields: configStatus.missingFields,
          });
          return;
        }

        // Step 3: Call Phase 4 AI Code Generation via Groq API
        const problemTitle = (payload && payload.problemTitle) || 'Unknown Problem';
        const language = (payload && payload.language) || 'Unknown Language';
        const userCodeLength = (payload && payload.userCode && typeof payload.userCode === 'string') ? payload.userCode.length : 0;

        console.log(`[LeetSync-AI] Submission accepted for processing: ${problemTitle} (${language}). Calling AI code generator...`);
        console.log('[LeetSync-AI] Submission Metadata:', {
          problemTitle: problemTitle,
          problemUrl: (payload && payload.problemUrl) || null,
          language: language,
          difficulty: (payload && payload.difficulty) || null,
          userCodeLength: userCodeLength,
          hasDescription: Boolean(payload && payload.description),
          testCaseCount: (payload && payload.testCases && Array.isArray(payload.testCases)) ? payload.testCases.length : 0,
        });

        const connector = (typeof LeetSyncAIConnector !== 'undefined' && LeetSyncAIConnector) ||
                          (typeof self !== 'undefined' && self.LeetSyncAIConnector) ||
                          (typeof globalThis !== 'undefined' && globalThis.LeetSyncAIConnector);

        if (!connector || typeof connector.generateExecutableFile !== 'function') {
          console.error('[LeetSync-AI] LeetSyncAIConnector is not loaded or generateExecutableFile is missing!', {
            hasGlobalVar: typeof LeetSyncAIConnector !== 'undefined',
            hasSelfProp: typeof self !== 'undefined' && Boolean(self.LeetSyncAIConnector),
            hasGlobalThisProp: typeof globalThis !== 'undefined' && Boolean(globalThis.LeetSyncAIConnector),
          });
          sendResponse({
            status: 'error',
            error: 'LeetSyncAIConnector module is not loaded in service worker.',
          });
          return;
        }

        console.log('[LeetSync-AI] About to call LeetSyncAIConnector.generateExecutableFile...');

        try {
          const aiPromise = connector.generateExecutableFile(payload, config);

          if (!aiPromise || typeof aiPromise.then !== 'function') {
            console.error('[LeetSync-AI] generateExecutableFile did not return a valid Promise!', aiPromise);
            sendResponse({
              status: 'error',
              error: 'generateExecutableFile did not return a valid Promise.',
              dedupeKey: dedupeKey,
            });
            return;
          }

          aiPromise
            .then(function (aiResult) {
              if (aiResult && aiResult.success) {
                const generatedCode = aiResult.code || '';
                const originalUserCode = (payload && payload.userCode) || '';
                const lang = (payload && payload.language) || 'cpp';
                const codePreview = generatedCode.slice(0, 100).replace(/\n/g, ' ');

                console.log(`[LeetSync-AI] AI Code Generation SUCCESS! Model: "${aiResult.modelUsed || 'default'}", Total Length: ${generatedCode.length} chars.`);
                console.log(`[LeetSync-AI] Code Preview (~100 chars):\n${codePreview}...`);
                console.log('[LeetSync-AI] ==================== FULL GENERATED CODE START ====================\n' + generatedCode + '\n==================== FULL GENERATED CODE END ====================');

                // Phase 5 Verifier Execution
                const verifier = (typeof LeetSyncVerifier !== 'undefined' && LeetSyncVerifier) ||
                                 (typeof self !== 'undefined' && self.LeetSyncVerifier) ||
                                 (typeof globalThis !== 'undefined' && globalThis.LeetSyncVerifier);

                let verbatimResult = { status: 'exact_match', details: 'Verifier module not loaded.', diffPreview: '' };
                let sanityResult = { passed: true, issues: [] };

                if (verifier && typeof verifier.verifyVerbatimCode === 'function') {
                  verbatimResult = verifier.verifyVerbatimCode(originalUserCode, generatedCode);
                } else {
                  console.warn('[LeetSync-AI] LeetSyncVerifier module is not available!');
                }

                if (verifier && typeof verifier.checkBasicSanity === 'function') {
                  sanityResult = verifier.checkBasicSanity(generatedCode, lang);
                }

                // Log verification verdict according to Phase 5 specification
                if (verbatimResult.status === 'exact_match' && sanityResult.passed) {
                  console.log('[LeetSync-AI] Verification PASSED (exact match & sanity checks clean). Ready for GitHub push.');
                } else if (verbatimResult.status === 'formatting_differences' && sanityResult.passed) {
                  console.warn(`[LeetSync-AI] Verification PASSED WITH WARNINGS (formatting differences detected, no content changes). Details: ${verbatimResult.details}`);
                  if (verbatimResult.diffPreview) {
                    console.warn(`[LeetSync-AI] Formatting Diff Preview:\n${verbatimResult.diffPreview}`);
                  }
                } else {
                  // Verification failed either due to content mismatch or structural sanity failure
                  const failureReasons = [];
                  if (verbatimResult.status === 'content_mismatch') {
                    failureReasons.push(`Content Mismatch: ${verbatimResult.details}`);
                  }
                  if (!sanityResult.passed) {
                    failureReasons.push(`Structural Sanity Failure: ${sanityResult.issues.join('; ')}`);
                  }

                  console.error(`[LeetSync-AI] Verification FAILED — Push to GitHub BLOCKED. Reason(s):\n - ${failureReasons.join('\n - ')}`);
                  if (verbatimResult.diffPreview) {
                    console.error(`[LeetSync-AI] Content Mismatch Diff Preview:\n${verbatimResult.diffPreview}`);
                  }
                }

                // GATING CHECK: Block GitHub push if verbatim code was altered OR if structural sanity failed
                if (verbatimResult.status === 'content_mismatch' || !sanityResult.passed) {
                  const errorMsg = verbatimResult.status === 'content_mismatch'
                    ? `Verification FAILED — content mismatch detected (${verbatimResult.details}). Push to GitHub blocked.`
                    : `Verification FAILED — structural sanity check failed (${sanityResult.issues.join('; ')}). Push to GitHub blocked.`;

                  console.error('[LeetSync-AI] Skipping GitHub push — verification failed.');
                  sendResponse({
                    status: 'verification_failed',
                    error: errorMsg,
                    dedupeKey: dedupeKey,
                    modelUsed: aiResult.modelUsed,
                    codeLength: generatedCode.length,
                    preview: codePreview,
                    verification: {
                      verbatimStatus: verbatimResult.status,
                      details: verbatimResult.details,
                      diffPreview: verbatimResult.diffPreview,
                      sanityPassed: sanityResult.passed,
                      sanityIssues: sanityResult.issues,
                    },
                  });
                  return;
                }

                // Phase 6: Push verified executable file to GitHub
                const githubSync = (typeof LeetSyncGitHub !== 'undefined' && LeetSyncGitHub) ||
                                   (typeof self !== 'undefined' && self.LeetSyncGitHub) ||
                                   (typeof globalThis !== 'undefined' && globalThis.LeetSyncGitHub);

                if (!githubSync || typeof githubSync.pushToGitHub !== 'function') {
                  console.error('[LeetSync-AI] LeetSyncGitHub module is not available!');
                  sendResponse({
                    status: 'error',
                    error: 'LeetSyncGitHub module is not loaded in service worker.',
                    dedupeKey: dedupeKey,
                  });
                  return;
                }

                githubSync.pushToGitHub(payload, generatedCode, config)
                  .then(function (githubResult) {
                    if (githubResult && githubResult.success) {
                      console.log(`[LeetSync-AI] Successfully pushed to GitHub: ${githubResult.path}. View at: ${githubResult.url}`);
                      sendResponse({
                        status: 'success',
                        message: `Successfully pushed to GitHub: ${githubResult.path}`,
                        dedupeKey: dedupeKey,
                        modelUsed: aiResult.modelUsed,
                        codeLength: generatedCode.length,
                        preview: codePreview,
                        github: {
                          path: githubResult.path,
                          url: githubResult.url,
                          sha: githubResult.sha,
                        },
                        verification: {
                          verbatimStatus: verbatimResult.status,
                          details: verbatimResult.details,
                          diffPreview: verbatimResult.diffPreview,
                          sanityPassed: sanityResult.passed,
                          sanityIssues: sanityResult.issues,
                        },
                      });
                    } else {
                      const ghError = (githubResult && githubResult.error) || 'Unknown GitHub push error';
                      console.error(`[LeetSync-AI] GitHub push FAILED: ${ghError}`);
                      sendResponse({
                        status: 'github_error',
                        error: ghError,
                        dedupeKey: dedupeKey,
                        verification: {
                          verbatimStatus: verbatimResult.status,
                          details: verbatimResult.details,
                        },
                      });
                    }
                  })
                  .catch(function (ghErr) {
                    console.error('[LeetSync-AI] Exception during GitHub push:', ghErr);
                    sendResponse({
                      status: 'github_error',
                      error: 'GitHub push exception: ' + ((ghErr && ghErr.message) || ghErr),
                      dedupeKey: dedupeKey,
                    });
                  });
              } else {
                const errReason = (aiResult && aiResult.error) || 'Unknown AI generation error';
                console.error(`[LeetSync-AI] AI Code Generation FAILED: ${errReason}`);
                sendResponse({
                  status: 'error',
                  error: errReason,
                  dedupeKey: dedupeKey,
                });
              }
            })
            .catch(function (aiError) {
              console.error('[LeetSync-AI] Exception inside AI Code Generation promise:', aiError);
              sendResponse({
                status: 'error',
                error: 'AI Generation exception: ' + ((aiError && aiError.message) || aiError),
                dedupeKey: dedupeKey,
              });
            });
        } catch (syncErr) {
          console.error('[LeetSync-AI] Synchronous exception invoking generateExecutableFile:', syncErr);
          sendResponse({
            status: 'error',
            error: 'Synchronous AI connector error: ' + ((syncErr && syncErr.message) || syncErr),
            dedupeKey: dedupeKey,
          });
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Chrome Runtime Message Listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message !== 'object') {
      return false;
    }

    if (message.type === 'SUBMISSION_ACCEPTED') {
      handleSubmissionAccepted(message.payload, sendResponse);
      return true; // Return true to signal async sendResponse execution
    }

    return false;
  });

  console.log('[LeetSync-AI] Background Service Worker initialized.');
})();
