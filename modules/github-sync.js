// modules/github-sync.js
// =============================================================================
// LeetSync-AI GitHub Sync Module — implemented in Phase 6.
// Pushes verified AI-generated LeetCode executable files to user's GitHub repo
// via GitHub REST API (v3).
// Never logs secret Personal Access Token values.
// =============================================================================

/**
 * @namespace LeetSyncGitHub
 */
// eslint-disable-next-line no-var
var LeetSyncGitHub = (function () {
  'use strict';

  // Language mapping to folder names and file extensions
  const LANGUAGE_MAP = {
    'java': { folder: 'Java', ext: 'java' },
    'python': { folder: 'Python', ext: 'py' },
    'python3': { folder: 'Python', ext: 'py' },
    'cpp': { folder: 'C++', ext: 'cpp' },
    'c++': { folder: 'C++', ext: 'cpp' },
    'javascript': { folder: 'JavaScript', ext: 'js' },
    'js': { folder: 'JavaScript', ext: 'js' },
    'typescript': { folder: 'TypeScript', ext: 'ts' },
    'c#': { folder: 'C#', ext: 'cs' },
    'csharp': { folder: 'C#', ext: 'cs' },
    'c': { folder: 'C', ext: 'c' },
    'go': { folder: 'Go', ext: 'go' },
    'rust': { folder: 'Rust', ext: 'rs' },
    'ruby': { folder: 'Ruby', ext: 'rb' },
    'swift': { folder: 'Swift', ext: 'swift' },
    'kotlin': { folder: 'Kotlin', ext: 'kt' },
    'scala': { folder: 'Scala', ext: 'scala' },
    'php': { folder: 'PHP', ext: 'php' },
  };

  /**
   * Base64 encodes UTF-8 string safely using TextEncoder.
   * @param {string} str
   * @returns {string} Base64 string
   */
  function utf8ToBase64(str) {
    if (typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
    return btoa(unescape(encodeURIComponent(str)));
  }

  /**
   * Parses repository owner and repo name from config string.
   * Handles "owner/repo", "https://github.com/owner/repo", etc.
   * @param {string} repoStr
   * @returns {{ owner: string, repo: string }|null}
   */
  function parseRepoString(repoStr) {
    if (!repoStr || typeof repoStr !== 'string') return null;
    let cleaned = repoStr.trim();
    cleaned = cleaned.replace(/^https?:\/\/github\.com\//i, '');
    cleaned = cleaned.replace(/^github\.com\//i, '');
    cleaned = cleaned.replace(/\/+$/, '');

    const parts = cleaned.split('/');
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      return {
        owner: parts[0].trim(),
        repo: parts[1].trim().replace(/\.git$/i, ''),
      };
    }
    return null;
  }

  /**
   * Resolves target folder, file extension, and repo path for a submission.
   * @param {Object} submissionData
   * @returns {string} Relative path within repository (e.g. "Java/two-sum.java")
   */
  function resolveFilePath(submissionData) {
    const rawLang = (submissionData && submissionData.language) ? submissionData.language.trim().toLowerCase() : 'java';
    const langConfig = LANGUAGE_MAP[rawLang] || { folder: rawLang, ext: 'txt' };

    let slug = '';
    if (submissionData && typeof submissionData.problemUrl === 'string' && submissionData.problemUrl.trim()) {
      const match = submissionData.problemUrl.match(/\/problems\/([^/#?]+)/i);
      if (match && match[1]) {
        slug = match[1].toLowerCase().trim();
      }
    }

    if (!slug && submissionData && typeof submissionData.problemTitle === 'string' && submissionData.problemTitle.trim()) {
      const cleanedTitle = submissionData.problemTitle.replace(/^\d+\.\s*/, '').trim().toLowerCase();
      slug = cleanedTitle.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    if (!slug) {
      slug = 'unknown-problem';
    }

    return `${langConfig.folder}/${slug}.${langConfig.ext}`;
  }

  /**
   * Pushes a verified AI-generated file to GitHub REST API.
   * Never logs secret PAT values.
   *
   * @param {Object} submissionData - Submission metadata (problemTitle, problemUrl, language, etc.)
   * @param {string} generatedFileContent - The verified file content to push
   * @param {Object} config - Configuration object with githubToken and githubRepo
   * @returns {Promise<{ success: boolean, path?: string, url?: string, sha?: string, error?: string, statusCode?: number }>}
   */
  async function pushToGitHub(submissionData, generatedFileContent, config) {
    console.log('[LeetSync-AI] Preparing to push file to GitHub...');

    try {
      // 1. Validate inputs & auth config
      if (!config || !config.githubToken || !config.githubToken.trim()) {
        console.warn('[LeetSync-AI] GitHub push aborted: GitHub Personal Access Token is missing.');
        return {
          success: false,
          error: 'GitHub Token is missing. Please configure it in settings.',
        };
      }

      if (!config.githubRepo || !config.githubRepo.trim()) {
        console.warn('[LeetSync-AI] GitHub push aborted: GitHub Repository is missing.');
        return {
          success: false,
          error: 'GitHub Repository is missing. Please configure it in settings.',
        };
      }

      const repoInfo = parseRepoString(config.githubRepo);
      if (!repoInfo) {
        console.error(`[LeetSync-AI] Invalid GitHub repository format: "${config.githubRepo}". Expected "owner/repo".`);
        return {
          success: false,
          error: `Invalid repository format "${config.githubRepo}". Please use "owner/repo" format.`,
        };
      }

      const token = config.githubToken.trim();
      console.log(`[LeetSync-AI] GitHub Token present: true (length: ${token.length}). Target Repository: "${repoInfo.owner}/${repoInfo.repo}".`);

      if (!generatedFileContent || typeof generatedFileContent !== 'string' || !generatedFileContent.trim()) {
        return {
          success: false,
          error: 'Cannot push file to GitHub — generated code content is empty.',
        };
      }

      // 2. Resolve file path & commit message
      const filePath = resolveFilePath(submissionData);
      const title = (submissionData && submissionData.problemTitle) || 'LeetCode Problem';
      const lang = (submissionData && submissionData.language) || 'Code';
      const commitMessage = `Add solution: ${title} (${lang})`;

      console.log(`[LeetSync-AI] Resolved GitHub file path: "${filePath}". Checking if file exists...`);

      // 3. SHA Lookup (GET contents endpoint)
      const contentsUrl = `https://api.github.com/repos/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;

      const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'LeetSync-AI-Extension',
      };

      let existingSha = null;

      try {
        const getResponse = await fetch(contentsUrl, { method: 'GET', headers: headers });
        if (getResponse.status === 200) {
          const getData = await getResponse.json();
          existingSha = getData.sha || null;
          console.log(`[LeetSync-AI] Existing file found at "${filePath}". SHA: "${existingSha}". Updating file...`);
        } else if (getResponse.status === 404) {
          console.log(`[LeetSync-AI] File "${filePath}" does not exist yet. Creating new file...`);
        } else if (getResponse.status === 401) {
          console.error('[LeetSync-AI] GitHub API 401 Unauthorized: Invalid Personal Access Token.');
          return {
            success: false,
            error: 'GitHub API 401 Unauthorized: Invalid Personal Access Token. Please check settings.',
            statusCode: 401,
          };
        } else if (getResponse.status === 403) {
          const errText = await getResponse.text();
          console.error(`[LeetSync-AI] GitHub API 403 Forbidden/Rate Limited: ${errText}`);
          return {
            success: false,
            error: 'GitHub API 403 Forbidden: Token may lack repository write permissions or rate limit exceeded.',
            statusCode: 403,
          };
        } else {
          const errText = await getResponse.text();
          console.warn(`[LeetSync-AI] Unexpected GET file status HTTP ${getResponse.status}: ${errText}`);
        }
      } catch (getErr) {
        console.warn('[LeetSync-AI] Exception checking existing file SHA:', getErr);
      }

      // 4. Encode Content & PUT File
      const base64Content = utf8ToBase64(generatedFileContent);

      const putBody = {
        message: commitMessage,
        content: base64Content,
      };

      if (existingSha) {
        putBody.sha = existingSha;
      }

      console.log(`[LeetSync-AI] Pushing file content (${base64Content.length} base64 chars) to "${contentsUrl}"...`);

      const putResponse = await fetch(contentsUrl, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(putBody),
      });

      const putStatus = putResponse.status;
      const putDataText = await putResponse.text();
      let putDataJson = null;
      try { putDataJson = JSON.parse(putDataText); } catch (_) {}

      if (putStatus === 200 || putStatus === 201) {
        const fileUrl = (putDataJson && putDataJson.content && putDataJson.content.html_url) ||
                        (putDataJson && putDataJson.commit && putDataJson.commit.html_url) ||
                        `https://github.com/${repoInfo.owner}/${repoInfo.repo}/blob/main/${filePath}`;

        console.log(`[LeetSync-AI] Successfully pushed to GitHub: ${filePath}. View at: ${fileUrl}`);

        return {
          success: true,
          path: filePath,
          url: fileUrl,
          sha: (putDataJson && putDataJson.content && putDataJson.content.sha) || existingSha,
        };
      }

      // Handle PUT error responses
      const errMsg = (putDataJson && putDataJson.message) || putDataText;
      let detailedErr = `GitHub API Error (${putStatus}): ${errMsg}`;

      if (putStatus === 401) {
        detailedErr = 'GitHub 401 Unauthorized: Invalid Personal Access Token.';
      } else if (putStatus === 404) {
        detailedErr = `GitHub 404 Not Found: Repository "${repoInfo.owner}/${repoInfo.repo}" does not exist or token lacks access.`;
      } else if (putStatus === 403) {
        detailedErr = 'GitHub 403 Forbidden: Token lacks repo scope write permission.';
      } else if (putStatus === 422) {
        detailedErr = `GitHub 422 Unprocessable Entity: ${errMsg}`;
      }

      console.error(`[LeetSync-AI] GitHub Push FAILED: ${detailedErr}`);

      return {
        success: false,
        error: detailedErr,
        statusCode: putStatus,
      };

    } catch (err) {
      console.error('[LeetSync-AI] Unexpected exception pushing file to GitHub:', err);
      return {
        success: false,
        error: 'Unexpected GitHub sync error: ' + (err.message || err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    pushToGitHub: pushToGitHub,
    _resolveFilePath: resolveFilePath,
    _parseRepoString: parseRepoString,
    _utf8ToBase64: utf8ToBase64,
  };
})();
