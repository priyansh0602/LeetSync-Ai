// popup.js
// =============================================================================
// LeetSync-AI Extension Settings Popup Logic
// Handles loading, toggling, validating, and saving API keys & repo settings
// locally via chrome.storage.local, with session storage draft auto-save.
// =============================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Storage Key Constants
  // ---------------------------------------------------------------------------
  const CONFIRMED_KEY = 'leetsyncConfig';
  const DRAFT_KEY = 'leetsyncConfigDraft';

  // ---------------------------------------------------------------------------
  // DOM Elements
  // ---------------------------------------------------------------------------
  const settingsForm = document.getElementById('settings-form');
  const groqInput = document.getElementById('groq-api-key');
  const githubTokenInput = document.getElementById('github-token');
  const githubRepoInput = document.getElementById('github-repo');
  
  const toggleGroqBtn = document.getElementById('toggle-groq-key');
  const toggleGithubBtn = document.getElementById('toggle-github-token');

  const statusBadge = document.getElementById('status-badge');
  const introBanner = document.getElementById('intro-banner');
  const toast = document.getElementById('toast');

  let toastTimeout = null;
  let draftSaveTimeout = null;

  // ---------------------------------------------------------------------------
  // Toast Helper (Non-blocking notification)
  // ---------------------------------------------------------------------------
  function showToast(message, type = 'success', durationMs = 2500) {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }

    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');

    if (durationMs > 0) {
      toastTimeout = setTimeout(function () {
        toast.classList.add('hidden');
      }, durationMs);
    }
  }

  function hideToast() {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
    toast.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Status Badge & Intro Banner Updates
  // ---------------------------------------------------------------------------
  function updateUIStatus(isConfigured) {
    if (isConfigured) {
      statusBadge.textContent = 'Configured';
      statusBadge.className = 'badge badge-configured';
      introBanner.classList.add('hidden');
    } else {
      statusBadge.textContent = 'Setup Required';
      statusBadge.className = 'badge badge-unconfigured';
      introBanner.classList.remove('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // Password Visibility Toggle Logic
  // ---------------------------------------------------------------------------
  function setupEyeToggle(buttonEl, inputEl) {
    if (!buttonEl || !inputEl) return;

    buttonEl.addEventListener('click', function () {
      const isPassword = inputEl.type === 'password';
      inputEl.type = isPassword ? 'text' : 'password';

      const eyeOff = buttonEl.querySelector('.eye-off');
      const eyeOn = buttonEl.querySelector('.eye-on');

      if (isPassword) {
        if (eyeOff) eyeOff.classList.add('hidden');
        if (eyeOn) eyeOn.classList.remove('hidden');
      } else {
        if (eyeOff) eyeOff.classList.remove('hidden');
        if (eyeOn) eyeOn.classList.add('hidden');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Validation Helpers
  // ---------------------------------------------------------------------------
  function isValidRepoFormat(repoStr) {
    if (!repoStr) return false;
    const parts = repoStr.split('/');
    if (parts.length !== 2) return false;
    const owner = parts[0].trim();
    const repo = parts[1].trim();
    return owner.length > 0 && repo.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Session Storage Draft Saving Logic
  // ---------------------------------------------------------------------------
  function saveDraft() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) {
      return;
    }

    const draftData = {
      groqApiKey: groqInput.value,
      githubToken: githubTokenInput.value,
      githubRepo: githubRepoInput.value,
    };

    chrome.storage.session.set({ [DRAFT_KEY]: draftData }, function () {
      if (chrome.runtime.lastError) {
        // Silently ignore session storage errors if any
      }
    });
  }

  function scheduleDraftSave() {
    if (draftSaveTimeout) {
      clearTimeout(draftSaveTimeout);
    }
    draftSaveTimeout = setTimeout(saveDraft, 100);
  }

  function clearDraft() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) {
      return;
    }
    chrome.storage.session.remove([DRAFT_KEY]);
  }

  // ---------------------------------------------------------------------------
  // Storage Load Logic (Session Draft Priority -> Local Confirmed Fallback)
  // ---------------------------------------------------------------------------
  function loadSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }

    // Check chrome.storage.session FIRST for active draft
    if (chrome.storage.session) {
      chrome.storage.session.get([DRAFT_KEY], function (sessionResult) {
        const draft = sessionResult ? sessionResult[DRAFT_KEY] : null;

        if (draft && (draft.groqApiKey || draft.githubToken || draft.githubRepo)) {
          // Priority 1: Restore unsaved draft from active browser session
          if (typeof draft.groqApiKey === 'string') groqInput.value = draft.groqApiKey;
          if (typeof draft.githubToken === 'string') githubTokenInput.value = draft.githubToken;
          if (typeof draft.githubRepo === 'string') githubRepoInput.value = draft.githubRepo;

          checkConfiguredStatus();
          return;
        }

        // Priority 2: Fall back to confirmed chrome.storage.local
        loadConfirmedLocalSettings();
      });
    } else {
      loadConfirmedLocalSettings();
    }
  }

  function loadConfirmedLocalSettings() {
    if (!chrome.storage.local) return;

    chrome.storage.local.get([CONFIRMED_KEY], function (result) {
      if (chrome.runtime.lastError) {
        showToast('Error loading saved settings', 'error');
        return;
      }

      const config = result ? result[CONFIRMED_KEY] : null;
      if (config) {
        if (typeof config.groqApiKey === 'string') groqInput.value = config.groqApiKey;
        if (typeof config.githubToken === 'string') githubTokenInput.value = config.githubToken;
        if (typeof config.githubRepo === 'string') githubRepoInput.value = config.githubRepo;

        checkConfiguredStatus();
      } else {
        updateUIStatus(false);
      }
    });
  }

  function checkConfiguredStatus() {
    if (!chrome.storage.local) return;

    chrome.storage.local.get([CONFIRMED_KEY], function (result) {
      const config = result ? result[CONFIRMED_KEY] : null;
      const isFullyConfigured =
        Boolean(config && config.groqApiKey && config.groqApiKey.trim()) &&
        Boolean(config && config.githubToken && config.githubToken.trim()) &&
        Boolean(config && isValidRepoFormat(config.githubRepo));

      updateUIStatus(isFullyConfigured);
    });
  }

  // ---------------------------------------------------------------------------
  // Storage Save Logic
  // ---------------------------------------------------------------------------
  function saveSettings(e) {
    e.preventDefault();
    hideToast();

    // Reset error styles
    groqInput.classList.remove('invalid');
    githubTokenInput.classList.remove('invalid');
    githubRepoInput.classList.remove('invalid');

    const groqApiKey = groqInput.value.trim();
    const githubToken = githubTokenInput.value.trim();
    const githubRepo = githubRepoInput.value.trim();

    let hasError = false;

    if (!groqApiKey) {
      groqInput.classList.add('invalid');
      hasError = true;
    }

    if (!githubToken) {
      githubTokenInput.classList.add('invalid');
      hasError = true;
    }

    if (!githubRepo || !isValidRepoFormat(githubRepo)) {
      githubRepoInput.classList.add('invalid');
      if (!githubRepo) {
        hasError = true;
      } else {
        showToast("Repository must be in 'owner/repo' format (e.g. octocat/leetcode-solutions)", 'error', 4000);
        return;
      }
    }

    if (hasError) {
      showToast('Please fill in all required fields', 'error', 3000);
      return;
    }

    const configData = {
      groqApiKey: groqApiKey,
      githubToken: githubToken,
      githubRepo: githubRepo,
    };

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      showToast('Storage API unavailable', 'error');
      return;
    }

    // Save to chrome.storage.local — NEVER log secret keys/tokens to console
    chrome.storage.local.set({ [CONFIRMED_KEY]: configData }, function () {
      if (chrome.runtime.lastError) {
        showToast('Failed to save settings: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      // Clear draft from chrome.storage.session since it has been saved
      clearDraft();

      updateUIStatus(true);
      showToast('Settings saved successfully', 'success', 2500);
    });
  }

  // ---------------------------------------------------------------------------
  // Event Listeners Initialization
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    setupEyeToggle(toggleGroqBtn, groqInput);
    setupEyeToggle(toggleGithubBtn, githubTokenInput);

    if (settingsForm) {
      settingsForm.addEventListener('submit', saveSettings);
    }

    // Auto-save draft to session storage on every input change
    [groqInput, githubTokenInput, githubRepoInput].forEach(function (inputEl) {
      if (inputEl) {
        inputEl.addEventListener('input', function () {
          inputEl.classList.remove('invalid');
          scheduleDraftSave();
        });
      }
    });

    loadSettings();
  });
})();
