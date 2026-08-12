// modules/verifier.js
// =============================================================================
// LeetSync-AI Verifier Module — implemented in Phase 5.
// Enforces verbatim preservation of accepted LeetCode user code in AI-generated
// executable files, and performs basic structural sanity checks before GitHub push.
// =============================================================================

/**
 * @namespace LeetSyncVerifier
 */
// eslint-disable-next-line no-var
var LeetSyncVerifier = (function () {
  'use strict';

  /**
   * Helper to check balanced braces, parens, and brackets while ignoring comments and strings.
   * @param {string} code
   * @returns {string|null} Description of bracket issue or null if balanced.
   */
  function checkBracketBalance(code) {
    let braceCount = 0;   // {}
    let parenCount = 0;   // ()
    let bracketCount = 0; // []

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      const nextChar = code[i + 1] || '';

      // Handle comments end
      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      // Handle strings end
      if (inSingleQuote) {
        if (char === '\\') { i++; continue; }
        if (char === "'") inSingleQuote = false;
        continue;
      }
      if (inDoubleQuote) {
        if (char === '\\') { i++; continue; }
        if (char === '"') inDoubleQuote = false;
        continue;
      }
      if (inBacktick) {
        if (char === '\\') { i++; continue; }
        if (char === '`') inBacktick = false;
        continue;
      }

      // Handle comments start
      if (char === '/' && nextChar === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      if (char === '#') {
        inLineComment = true;
        continue;
      }

      // Handle strings start
      if (char === "'") { inSingleQuote = true; continue; }
      if (char === '"') { inDoubleQuote = true; continue; }
      if (char === '`') { inBacktick = true; continue; }

      // Count brackets
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '(') parenCount++;
      else if (char === ')') parenCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;

      if (braceCount < 0) return 'Unbalanced braces: closing "}" found without opening "{".';
      if (parenCount < 0) return 'Unbalanced parentheses: closing ")" found without opening "(".';
      if (bracketCount < 0) return 'Unbalanced brackets: closing "]" found without opening "[".';
    }

    const unbalanced = [];
    if (braceCount !== 0) unbalanced.push(`braces ({}: ${braceCount > 0 ? '+' + braceCount : braceCount})`);
    if (parenCount !== 0) unbalanced.push(`parentheses ((): ${parenCount > 0 ? '+' + parenCount : parenCount})`);
    if (bracketCount !== 0) unbalanced.push(`brackets ([]: ${bracketCount > 0 ? '+' + bracketCount : bracketCount})`);

    if (unbalanced.length > 0) {
      return `Unbalanced delimiters detected: ${unbalanced.join(', ')}.`;
    }

    return null;
  }

  /**
   * Verifies that the user's original code is present inside generatedFileContent.
   * Handles exact match, formatting-only differences (e.g. blank lines stripped),
   * and flags hard content mismatches.
   *
   * @param {string} originalUserCode
   * @param {string} generatedFileContent
   * @returns {{ status: ('exact_match'|'formatting_differences'|'content_mismatch'), details: string, diffPreview: string }}
   */
  function verifyVerbatimCode(originalUserCode, generatedFileContent) {
    if (typeof originalUserCode !== 'string' || !originalUserCode.trim()) {
      console.warn('[LeetSync-AI][Verifier] originalUserCode is empty or not a string.');
      return {
        status: 'content_mismatch',
        details: 'Original user code is empty or invalid.',
        diffPreview: 'Original code: (empty)',
      };
    }

    if (typeof generatedFileContent !== 'string' || !generatedFileContent.trim()) {
      console.warn('[LeetSync-AI][Verifier] generatedFileContent is empty or not a string.');
      return {
        status: 'content_mismatch',
        details: 'Generated file content is empty or invalid.',
        diffPreview: 'Generated content: (empty)',
      };
    }

    // Granular debug logging requested for diagnostics
    const origBlankLines = (originalUserCode.match(/\n[ \t]*\n/g) || []).length;
    const genBlankLines = (generatedFileContent.match(/\n[ \t]*\n/g) || []).length;

    console.log('[LeetSync-AI][Verifier] ================= VERIFIER COMPARISON DEBUG =================');
    console.log(`[LeetSync-AI][Verifier] originalUserCode length: ${originalUserCode.length} chars, total lines: ${originalUserCode.split('\n').length}, blank lines: ${origBlankLines}`);
    console.log(`[LeetSync-AI][Verifier] originalUserCode START (first 50): ${JSON.stringify(originalUserCode.slice(0, 50))}`);
    console.log(`[LeetSync-AI][Verifier] originalUserCode END   (last 50):  ${JSON.stringify(originalUserCode.slice(-50))}`);
    console.log(`[LeetSync-AI][Verifier] generatedFileContent length: ${generatedFileContent.length} chars, total lines: ${generatedFileContent.split('\n').length}, blank lines: ${genBlankLines}`);
    console.log(`[LeetSync-AI][Verifier] generatedFileContent START (first 50): ${JSON.stringify(generatedFileContent.slice(0, 50))}`);
    console.log(`[LeetSync-AI][Verifier] generatedFileContent END   (last 50):  ${JSON.stringify(generatedFileContent.slice(-50))}`);

    // Normalize CRLF to LF for exact substring check
    const normOriginal = originalUserCode.replace(/\r\n/g, '\n');
    const normGenerated = generatedFileContent.replace(/\r\n/g, '\n');

    // 1. Exact Substring Match
    if (normGenerated.includes(normOriginal)) {
      console.log('[LeetSync-AI][Verifier] Result: EXACT SUBSTRING MATCH (status: exact_match).');
      console.log('[LeetSync-AI][Verifier] ==========================================================');
      return {
        status: 'exact_match',
        details: 'Original user code found 100% intact character-for-character inside generated file.',
        diffPreview: '',
      };
    }

    console.log('[LeetSync-AI][Verifier] Exact substring match returned FALSE. Proceeding to line-by-line normalized comparison...');

    // 2. Whitespace-Normalized Comparison
    const origLines = normOriginal.split('\n');
    const genLines = normGenerated.split('\n');

    // Extract non-empty lines with original line numbers
    const origNonEmpty = origLines
      .map((line, idx) => ({ lineNo: idx + 1, raw: line, trimmed: line.trim() }))
      .filter((item) => item.trimmed !== '');

    const genNonEmpty = genLines
      .map((line, idx) => ({ lineNo: idx + 1, raw: line, trimmed: line.trim() }))
      .filter((item) => item.trimmed !== '');

    if (origNonEmpty.length === 0) {
      console.log('[LeetSync-AI][Verifier] Original code contains only whitespace. Returning exact_match.');
      return {
        status: 'exact_match',
        details: 'Original user code contains only whitespace.',
        diffPreview: '',
      };
    }

    // Search for origNonEmpty sequence inside genNonEmpty
    let matchStartIdx = -1;

    for (let i = 0; i <= genNonEmpty.length - origNonEmpty.length; i++) {
      let isMatch = true;
      for (let j = 0; j < origNonEmpty.length; j++) {
        if (genNonEmpty[i + j].trimmed !== origNonEmpty[j].trimmed) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matchStartIdx = i;
        break;
      }
    }

    if (matchStartIdx !== -1) {
      // The non-empty lines match 100%!
      const origBlankCount = origLines.length - origNonEmpty.length;
      const genSegmentStartLine = genNonEmpty[matchStartIdx].lineNo;
      const genSegmentEndLine = genNonEmpty[matchStartIdx + origNonEmpty.length - 1].lineNo;
      const genSegmentLines = genLines.slice(genSegmentStartLine - 1, genSegmentEndLine);
      const genSegmentBlankCount = genSegmentLines.filter((l) => l.trim() === '').length;

      const blankLinesDiff = origBlankCount - genSegmentBlankCount;

      let details = 'User code statements match completely, but formatting differences were detected.';
      if (blankLinesDiff > 0) {
        details += ` AI stripped ${blankLinesDiff} blank line(s) from the original code.`;
      } else {
        details += ` Indentation or line spacing differed.`;
      }

      let diffPreview = '';
      for (let k = 0; k < origNonEmpty.length; k++) {
        const origItem = origNonEmpty[k];
        const genItem = genNonEmpty[matchStartIdx + k];
        if (origItem.raw !== genItem.raw) {
          diffPreview = `Example formatting difference:\n` +
            `  Original (Line ${origItem.lineNo}): "${origItem.raw}"\n` +
            `  Generated (Line ${genItem.lineNo}): "${genItem.raw}"`;
          break;
        }
      }
      if (!diffPreview && blankLinesDiff > 0) {
        diffPreview = `Blank lines stripped by AI: Original had ${origBlankCount} empty lines in code block; generated segment has ${genSegmentBlankCount}.`;
      }

      console.log(`[LeetSync-AI][Verifier] Result: FORMATTING DIFFERENCES (status: formatting_differences). Details: ${details}`);
      console.log('[LeetSync-AI][Verifier] ==========================================================');

      return {
        status: 'formatting_differences',
        details: details,
        diffPreview: diffPreview,
      };
    }

    // 3. Content Mismatch (Logical or statement changes occurred)
    let bestStartIdx = -1;
    let maxMatchLen = 0;

    for (let i = 0; i < genNonEmpty.length; i++) {
      if (genNonEmpty[i].trimmed === origNonEmpty[0].trimmed) {
        let currentLen = 0;
        while (
          currentLen < origNonEmpty.length &&
          i + currentLen < genNonEmpty.length &&
          genNonEmpty[i + currentLen].trimmed === origNonEmpty[currentLen].trimmed
        ) {
          currentLen++;
        }
        if (currentLen > maxMatchLen) {
          maxMatchLen = currentLen;
          bestStartIdx = i;
        }
      }
    }

    let diffPreview = '';
    if (bestStartIdx !== -1 && maxMatchLen < origNonEmpty.length) {
      const origErr = origNonEmpty[maxMatchLen];
      const genErr = genNonEmpty[bestStartIdx + maxMatchLen];
      diffPreview = `Divergence at statement #${maxMatchLen + 1}:\n` +
        `  Expected (Original Line ${origErr.lineNo}): "${origErr.raw}"\n` +
        `  Actual   (Generated Line ${genErr ? genErr.lineNo : 'N/A'}): "${genErr ? genErr.raw : '(end of file)'}"`;
    } else {
      diffPreview = `First non-empty line of original code was not found anywhere in generated file:\n` +
        `  Expected: "${origNonEmpty[0].raw}"`;
    }

    console.log(`[LeetSync-AI][Verifier] Result: CONTENT MISMATCH (status: content_mismatch). Divergence diff preview:\n${diffPreview}`);
    console.log('[LeetSync-AI][Verifier] ==========================================================');

    return {
      status: 'content_mismatch',
      details: `Content mismatch: AI modified, omitted, or altered code statements. (Matched ${maxMatchLen} of ${origNonEmpty.length} statements before diverging).`,
      diffPreview: diffPreview,
    };
  }

  /**
   * Performs lightweight, language-agnostic structural sanity checks on generated code.
   *
   * @param {string} generatedFileContent
   * @param {string} [language]
   * @returns {{ passed: boolean, issues: string[] }}
   */
  function checkBasicSanity(generatedFileContent, language) {
    const issues = [];

    if (typeof generatedFileContent !== 'string' || !generatedFileContent.trim()) {
      return {
        passed: false,
        issues: ['Generated file content is empty or null.'],
      };
    }

    const trimmed = generatedFileContent.trim();

    // 1. Non-empty & Reasonable Size Check
    if (trimmed.length < 20) {
      issues.push(`Generated content is suspiciously short (${trimmed.length} characters, minimum expected 20).`);
    }

    // 2. Leftover Markdown Code Fences
    if (/```/.test(generatedFileContent)) {
      issues.push('Leftover markdown code fences (```) detected in output.');
    }

    // 3. Leftover LLM Chatter / Meta Text
    const chatterPatterns = [
      /^(here is|here's|below is|sure,|certainly|this is) the (code|solution|implementation|file)/i,
      /^(here is|here's) a (complete|runnable|java|cpp|c\+\+|python|solution)/i,
      /===USER_CODE/i,
      /hope this helps/i,
      /let me know if you need/i,
    ];

    const lines = generatedFileContent.split(/\r?\n/);
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const lineTrim = lines[i].trim();
      for (const pattern of chatterPatterns) {
        if (pattern.test(lineTrim)) {
          issues.push(`Leftover LLM conversational text or prompt marker detected near top of file: "${lineTrim.slice(0, 60)}"`);
          break;
        }
      }
    }

    for (let i = Math.max(0, lines.length - 5); i < lines.length; i++) {
      const lineTrim = lines[i].trim();
      if (/^(hope this helps|let me know if|feel free to ask)/i.test(lineTrim)) {
        issues.push(`Leftover LLM conversational text detected near end of file: "${lineTrim.slice(0, 60)}"`);
      }
    }

    // 4. Bracket Balancing Check ({}, (), [])
    const bracketIssues = checkBracketBalance(generatedFileContent);
    if (bracketIssues) {
      issues.push(bracketIssues);
    }

    // 5. Java Public Class Modifier Check
    const isJava = (typeof language === 'string' && /java/i.test(language)) || /\bclass\s+Solution\b/.test(generatedFileContent);
    if (isJava && /\bpublic\s+class\s+Solution\b/.test(generatedFileContent)) {
      issues.push('Java public class mismatch: "public class Solution" detected. In Java, Solution class must remain non-public (class Solution) when stored in problem-named files (e.g. two-sum.java) to prevent compilation failure.');
    }

    return {
      passed: issues.length === 0,
      issues: issues,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    verifyVerbatimCode: verifyVerbatimCode,
    checkBasicSanity: checkBasicSanity,
  };
})();
