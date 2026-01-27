# QA Playwright Plugin

AI-powered Playwright QA testing that **understands your codebase**.

## Overview

This plugin is not just a test generator—it is a **Context-Aware QA Engineer**. It allows you to run browser tests by describing them in plain English, but unlike standard tools, it **automatically refactors the output to match your project's existing structure**.

If you use a **Page Object Model (POM)**, this plugin will detect it, respect it, and write code that uses it.

## Key Features

1.  **Natural Language Testing**: "Login as admin and check the dashboard."
2.  **Self-Healing Execution**: Uses an AI Agent Loop to drive the browser, handling errors (like "element not found") in real-time.
3.  **Project-Aware Generation**: Automatically scans your codebase for existing Page Objects and uses them instead of raw selectors.
4.  **Zero-Config Context**: No manual context setup required. It indexes your project structure on the fly.

## Installation

```bash
# Clone or copy the plugin
cd qa-playwright-plugin

# Install dependencies
bun install

# Build
bun run build

# Link globally (optional)
npm link
```

## Usage

### Prerequisites

You need a **Gemini API Key** to power the AI agent.

```bash
export GEMINI_API_KEY=your_api_key_here
```

### Run a Test

Simply run the command in your project root:

```bash
qa-test "Login to the application with user 'admin' and password '1234'"
```

### CLI Options

```bash
qa-test "<instruction>" [options]

Options:
  -o, --output <dir>   Output directory for artifacts (default: ~/qa-playwright-results)
  -b, --base-url <url> Base URL for relative paths
  -t, --timeout <ms>   Timeout in milliseconds (default: 300000)
  -l, --log            Enable verbose logging of agent progress to stderr
  -h, --help           Show help
```

## How It Works: The Unified Workflow

When you run a command, the plugin executes a sophisticated 4-stage pipeline:

### Stage 1: The Agent Loop (Execution)
The plugin launches a **Gemini AI Agent** connected to a real browser (via Playwright).
*   It interprets your instruction ("Login").
*   It executes actions on the browser.
*   **Self-Correction**: If a selector fails, the agent sees the error, inspects the page, and tries a different approach immediately.

### Stage 2: Codebase Context Scan (Indexing)
Once the test is successful, the plugin prepares to save the code. Before writing a single line, it **scans your current working directory**.
*   It looks for TypeScript files that appear to be **Page Objects** (e.g., `LoginPage.ts`).
*   It builds a lightweight "Selector Map" of your project (e.g., "The selector `#username` belongs to `LoginPage`").

### Stage 3: Smart Refactoring (Synthesis)
The plugin takes the *raw* actions performed in Stage 1 and passes them through a **Refactor Engine**.
*   **Input**: `await page.fill('#username', 'admin')`
*   **Context Match**: "Wait, `#username` is managed by `LoginPage.ts`."
*   **Transformation**: The code is rewritten to instantiate and use your Page Object.

**Resulting Code:**
```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage'; // Automatically imported

test('Login Test', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.login('admin', '1234'); // Uses YOUR existing method
});
```

### Stage 4: Artifact Generation
Finally, the clean, project-aligned code is saved to your disk, ready to be committed to your repository.

## Architecture

```text
         [ User Instruction ]
                  │
        ┌─────────▼──────────┐
        │   QA Agent Loop    │  <-- 1. Drives Browser & Verifies Logic
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │   Context Scanner  │  <-- 2. Indexes YOUR Page Objects
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │   Refactor Engine  │  <-- 3. Rewrites Code to match Project Style
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────┐
        │   Final .spec.ts   │  <-- 4. Saves Clean Code
        └────────────────────┘
```

## License

PolyForm Noncommercial License 1.0.0. See [LICENSE](LICENSE) for details.
