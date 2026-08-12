// modules/ai-connector.js
// =============================================================================
// Groq API connector and prompt engine — implemented in Phase 4.
//
// CRITICAL MANDATORY CONSTRAINT:
// The user's userCode field — their exact, accepted LeetCode solution — MUST
// be reproduced character-for-character, with zero modification, in the AI's
// output.
// =============================================================================

/**
 * @namespace LeetSyncAIConnector
 */
// eslint-disable-next-line no-var
var LeetSyncAIConnector = (function () {
  'use strict';

  // Primary and fallback models on Groq
  // NOTE: If Groq deprecates llama-3.3-70b-versatile, check active models at https://api.groq.com/openai/v1/models
  const GROQ_MODEL_PRIMARY = 'llama-3.3-70b-versatile';
  const GROQ_MODEL_FALLBACK = 'llama-3.1-8b-instant';
  const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

  /**
   * System prompt enforcing strict verbatim code reproduction + scaffolding.
   */
  const SYSTEM_PROMPT = `You are a specialized code wrapper for LeetSync-AI. Your single task is to wrap an accepted LeetCode submission into a complete, self-contained, runnable file with a main entrypoint.

CRITICAL MANDATORY CONSTRAINT — ABSOLUTELY NON-NEGOTIABLE:
1. You MUST reproduce the user's exact code block (demarcated between ===USER_CODE_START=== and ===USER_CODE_END===) CHARACTER-FOR-CHARACTER with ZERO MODIFICATIONS.
2. DO NOT optimize, refactor, rewrite, clean up, or alter any logic inside the user's code block.
3. DO NOT change variable names, function names, formatting, indentation, spacing, or brace styles inside the user's code block. Preserve ALL whitespace exactly, including blank/empty lines within the code — do not compress, condense, or remove any blank lines that exist in the original code.
4. DO NOT add any comments inside or around the user's code block — not even "helpful" explanations.
5. DO NOT reorder, trim, or edit any statements or lines inside the user's code block.
6. DO NOT modify class declarations or modifiers (e.g., changing "class Solution" to "public class Solution"). In Java specifically, adding "public" to "class Solution" when the file is saved as a problem-named file (e.g. two-sum.java) causes Java compilation errors. Keep "class Solution" non-public exactly as written in the user's code. Keep the user's solution structure completely separate from any external scaffold helper code.
7. Ensure all external scaffolding, helper classes, and main test case code you generate are syntactically valid in the target language. Pay strict attention to parenthesis, bracket, and brace balance when constructing test inputs (e.g. deeply nested ListNode or TreeNode constructor calls).

YOUR ALLOWED ACTIONS:
- Generate necessary standard library imports/headers at the top of the file.
- Define necessary data structure helper classes (e.g. TreeNode, ListNode, Node) if required by the solution or problem.
- Insert the user's code block EXACTLY AS PROVIDED with all blank lines, whitespace, and exact class declarations preserved verbatim.
- Generate a main/entrypoint function that instantiates the solution class, constructs sample input data based on the provided test cases, calls the user's solution function, and prints the result to standard output.

OUTPUT FORMAT REQUIREMENTS:
- Output ONLY valid, raw executable source code in the specified target language.
- DO NOT wrap the code in markdown fences (NO \`\`\` or \`\`\`cpp or \`\`\`python).
- DO NOT add any introductory text, explanation, postscript, or markdown formatting outside the source code itself.`;

  /**
   * Builds user prompt message payload from submission metadata.
   * @param {Object} submissionData
   * @returns {string}
   */
  function buildUserPrompt(submissionData) {
    const title = (submissionData && submissionData.problemTitle) || 'LeetCode Problem';
    const lang = (submissionData && submissionData.language) || 'cpp';
    const diff = (submissionData && submissionData.difficulty) || 'Unknown';
    const desc = (submissionData && submissionData.description) || 'No description provided.';
    const userCode = (submissionData && submissionData.userCode) || '';
    const testCases = (submissionData && Array.isArray(submissionData.testCases)) ? JSON.stringify(submissionData.testCases, null, 2) : '[]';

    return `Target Language: ${lang}
Problem Title: ${title}
Difficulty: ${diff}

Problem Description:
${desc}

Sample Test Cases / Inputs:
${testCases}

User Accepted Code (Insert verbatim into the scaffold; DO NOT strip blank lines, DO NOT change "class Solution" to "public class Solution"):
===USER_CODE_START===
${userCode}
===USER_CODE_END===

Generate the complete runnable file in ${lang} now following all system instructions.`;
  }

  /**
   * Helper to clean any accidental markdown code fences returned by LLM.
   * @param {string} rawText
   * @returns {string}
   */
  function cleanCodeOutput(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.trim();

    // Strip leading markdown fences like ```cpp, ```python, ```
    if (text.startsWith('```')) {
      text = text.replace(/^```[a-zA-Z0-9_+-]*\n?/, '');
    }
    // Strip trailing markdown fence
    if (text.endsWith('```')) {
      text = text.replace(/\n?```$/, '');
    }

    return text.trim();
  }

  /**
   * Main function to call Groq API and generate executable file code.
   * Never logs secret API keys.
   *
   * @param {Object} submissionData - Extracted problem data (problemTitle, language, userCode, testCases, etc.)
   * @param {Object} [configOverride] - Optional config containing groqApiKey
   * @returns {Promise<{ success: boolean, code?: string, error?: string, modelUsed?: string }>}
   */
  async function generateExecutableFile(submissionData, configOverride) {
    console.log('[LeetSync-AI] LeetSyncAIConnector.generateExecutableFile invoked.');
    try {
      // 1. Resolve API Key
      let apiKey = configOverride && configOverride.groqApiKey;

      if (!apiKey) {
        // Read from chrome.storage.local
        const result = await new Promise(function (resolve) {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get('leetsyncConfig', resolve);
          } else {
            resolve({});
          }
        });
        const config = result && result.leetsyncConfig;
        if (config && typeof config.groqApiKey === 'string') {
          apiKey = config.groqApiKey.trim();
        }
      }

      if (!apiKey) {
        console.warn('[LeetSync-AI] Groq API call aborted: API key is missing or empty.');
        return {
          success: false,
          error: 'Groq API Key is missing. Please configure it in the extension popup.',
        };
      }

      console.log(`[LeetSync-AI] Groq API Key present: true (length: ${apiKey.length}). Preparing prompt...`);

      // 2. Validate userCode presence
      if (!submissionData || !submissionData.userCode || !submissionData.userCode.trim()) {
        return {
          success: false,
          error: 'Cannot generate code — submission userCode is missing or empty.',
        };
      }

      // 3. Build messages
      const userPrompt = buildUserPrompt(submissionData);
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      // 4. Try primary model first, fallback to secondary model if model_not_found
      const modelsToTry = [GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK];
      let lastError = null;

      for (const model of modelsToTry) {
        console.log(`[LeetSync-AI] Calling Groq API with model: "${model}"...`);

        try {
          const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify({
              model: model,
              messages: messages,
              temperature: 0.2,
              max_tokens: 4096,
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            let errJson = null;
            try { errJson = JSON.parse(errText); } catch (_) {}

            const errMessage = (errJson && errJson.error && errJson.error.message) || errText;
            console.warn(`[LeetSync-AI] Groq API returned HTTP ${response.status} (${response.statusText}) for model "${model}": ${errMessage}`);

            // Diagnostic note if model is not found / deprecated
            if (response.status === 404 || (errMessage && errMessage.includes('model'))) {
              console.error(`[LeetSync-AI] MODEL DIAGNOSTIC: Model "${model}" may be deprecated or invalid on Groq. Check active models at https://api.groq.com/openai/v1/models`);
            }

            lastError = `Groq API Error (${response.status}): ${errMessage}`;

            // If 401 Unauthorized, no need to try fallback model — API key is invalid
            if (response.status === 401) {
              return {
                success: false,
                error: 'Invalid Groq API Key (401 Unauthorized). Please check your key in settings.',
              };
            }

            // If rate limited (429), return error
            if (response.status === 429) {
              return {
                success: false,
                error: 'Groq API rate limit exceeded (429). Please wait a moment before trying again.',
              };
            }

            continue; // try fallback model
          }

          const data = await response.json();
          if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            lastError = 'Invalid response format from Groq API.';
            continue;
          }

          const rawGeneratedCode = data.choices[0].message.content || '';
          const cleanedCode = cleanCodeOutput(rawGeneratedCode);

          if (!cleanedCode) {
            lastError = 'Groq API returned an empty code response.';
            continue;
          }

          console.log(`[LeetSync-AI] AI Code Generation successful via model "${model}" (${cleanedCode.length} chars).`);

          return {
            success: true,
            code: cleanedCode,
            modelUsed: model,
          };
        } catch (fetchErr) {
          console.error(`[LeetSync-AI] Fetch error calling Groq API for model "${model}":`, fetchErr);
          lastError = 'Network error contacting Groq API: ' + (fetchErr.message || fetchErr);
        }
      }

      return {
        success: false,
        error: lastError || 'Failed to generate code via Groq API.',
      };

    } catch (err) {
      console.error('[LeetSync-AI] Unexpected error in generateExecutableFile:', err);
      return {
        success: false,
        error: 'Unexpected AI Connector error: ' + (err.message || err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    generateExecutableFile: generateExecutableFile,
    // Exposed helper functions for potential unit testing
    _buildUserPrompt: buildUserPrompt,
    _cleanCodeOutput: cleanCodeOutput,
    _SYSTEM_PROMPT: SYSTEM_PROMPT,
  };
})();
