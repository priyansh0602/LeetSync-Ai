# LeetSync-AI 🚀

> **Intelligent, Verbatim LeetCode GitHub Sync Chrome Extension**

LeetSync-AI is a modern Chrome extension (Manifest V3) that automatically syncs your accepted LeetCode solutions to GitHub. Unlike traditional tools that sync bare code snippets, LeetSync-AI uses AI (via Groq API) to transform your submission into a **complete, self-contained, executable file** with helper classes, imports, and runnable `main()` test cases.

---

## 🛡️ Core Guarantee & Safety Net

The fundamental promise of LeetSync-AI is that **your code is sacred**. The AI is strictly prohibited from altering, refactoring, or optimizing your solution logic.

Before any file is pushed to GitHub, it passes through a 2-stage verification system:
1. **Verbatim Code Verification**: Checks that your original submission code is 100% intact character-for-character inside the generated file.
2. **Structural Sanity Check**: Verifies delimiter balance (parentheses, braces, brackets), checks for leftover markdown fences or LLM chatter, and enforces Java non-public class scoping rules.

If the AI alters your logic or produces broken scaffolding, **the push to GitHub is blocked immediately** to prevent broken code from reaching your repository.

> *Note: LeetSync-AI is an open-source project tested across Java, Python, and C++. It is designed for individual developers who want clean, executable code repositories.*

---

## 🎯 Features & Language Support

- **Languages Supported (v1)**: 
  - ☕ **Java** (`.java`)
  - 🐍 **Python** (`.py`)
  - ⚡ **C++** (`.cpp`)
  - *(JavaScript / TypeScript support is currently experimental/untested)*
- **Problem Types Supported (v1)**: Standard Algorithms & Data Structures (Arrays, Strings, Linked Lists, Trees, Graphs, Dynamic Programming, etc.).
- **Automatic Metadata Scraping**: Captures problem title, difficulty, language, canonical URL, and example test cases.
- **Client-Side Storage**: No backend servers or middleman tracking. Credentials are saved locally in your browser.

---

## ⚙️ Installation Guide

Because LeetSync-AI is developer-focused, it is installed directly via Chrome Developer Mode:

1. **Clone or Download** this repository:
   ```bash
   git clone https://github.com/priyansh0602/LeetSync-Ai.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `LeetSyncAi` directory.

---

## 🔑 Configuration & Security

LeetSync-AI requires two credentials entered via the extension popup menu:

### 1. Free Groq API Key
- Sign up for a free account at [console.groq.com/keys](https://console.groq.com/keys).
- Create a new API key. (LeetSync-AI uses `llama-3.3-70b-versatile` with automatic fallback to `llama-3.1-8b-instant`).

### 2. GitHub Personal Access Token (PAT)
For maximum security, use a **Fine-grained Personal Access Token**:
- Go to **GitHub Settings** -> **Developer Settings** -> **Personal Access Tokens** -> **Fine-grained tokens**.
- Set **Repository Access**: Select *Only select repositories* and choose your target repo (e.g. `LeetSync-Ai` or `leetcode-solutions`).
- Set **Permissions**: Under **Repository permissions**, grant **Contents: Read and write**. Set all other permissions to *No access*.
- **Why Scoping Matters**: Fine-grained, repository-scoped access guarantees that even if your token is ever compromised, exposure is strictly limited to that single repository without risking your other personal projects or organization data.

---

## 🔄 How It Works

```
+-----------------------------------+
|  Submit Solution on LeetCode      |
+-----------------+-----------------+
                  |
                  v
+-----------------------------------+
|  "Accepted" Status Detected (DOM) |
+-----------------+-----------------+
                  |
                  v
+-----------------------------------+
|  Extract Code & Metadata          |
|  (In-Memory Monaco Editor Bridge) |
+-----------------+-----------------+
                  |
                  v
+-----------------------------------+
|  Generate Runnable File Scaffold  |
|  (Groq API / Llama 3.3 70B)       |
+-----------------+-----------------+
                  |
                  v
+-----------------------------------+
|  Verification Guardrail           |
|  - Verbatim User Code Match      |
|  - Structural Sanity & Syntax     |
+--------+-----------------+--------+
         |                 |
    [PASSED]           [FAILED]
         |                 |
         v                 v
+-----------------+   +------------------------------------+
| Sync to GitHub  |   | Block Push & Log Diagnostic Error  |
+-----------------+   +------------------------------------+
```

---

## 💰 Cost & Privacy

- **100% Free Forever**: No proxy servers, no hidden fees, no subscriptions.
- **Zero Data Collection**: All processing happens directly between your browser, LeetCode, Groq API, and GitHub API. No third-party servers observe your tokens or submissions.

---

## ⚠️ Known Limitations

1. **Monaco Virtualization Limits (DOM Fallback)**: Monaco virtualizes off-screen editor lines for rendering performance. LeetSync-AI uses the in-memory Monaco API (`monaco.editor.getEditors()[0].getValue()`) as primary. If the bridge ever fails or times out, DOM fallback is used, which may omit off-screen code lines for very long solutions.
2. **AI Scaffold Syntax Warnings**: On rare occasions, the AI may return an unbalanced delimiter in its generated test cases. The verification safety net will detect this and safely block the push. If this happens, re-submitting the problem will trigger a clean retry.
3. **Problem Categories**: SQL, Concurrency, Shell, and System Design problems are not supported in v1.

---
