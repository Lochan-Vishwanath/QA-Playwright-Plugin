#!/usr/bin/env node
/**
 * QA Playwright Plugin CLI
 * 
 * Usage:
 *   npx qa-playwright "Test instruction"
 *   npx qa-playwright "Navigate to /login and verify form appears" --output ~/results
 *   npx qa-playwright "Test checkout flow" --base-url https://staging.myapp.com
 *   npx qa-playwright "Login and toggle theme" --refactor --repo ~/my-playwright-repo
 */

import { runQATest } from "../src/runner";
import { formatOutput, createFailureResult } from "../src/output";
import { runRefactoringAgent } from "../src/refactor/refactor-agent";
import * as path from "path";
import * as os from "os";

// Parse CLI arguments
function parseArgs(args: string[]): {
    instruction: string;
    outputDir: string;
    baseUrl?: string;
    timeout?: number;
    verbose: boolean;
    help: boolean;
    refactor: boolean;
    repoPath?: string;
    dryRun: boolean;
} {
    const result = {
        instruction: "",
        outputDir: path.join(os.homedir(), "qa-playwright-results"),
        baseUrl: undefined as string | undefined,
        timeout: 300000, // 5 minutes default
        verbose: false,
        help: false,
        refactor: false,
        repoPath: undefined as string | undefined,
        dryRun: false,
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === "--help" || arg === "-h") {
            result.help = true;
            break;
        } else if (arg === "--output" || arg === "-o") {
            result.outputDir = args[++i] || result.outputDir;
        } else if (arg === "--base-url" || arg === "-b") {
            result.baseUrl = args[++i];
        } else if (arg === "--timeout" || arg === "-t") {
            result.timeout = parseInt(args[++i], 10) || result.timeout;
        } else if (arg === "--log" || arg === "-l") {
            result.verbose = true;
        } else if (arg === "--refactor" || arg === "-r") {
            result.refactor = true;
        } else if (arg === "--repo") {
            result.repoPath = args[++i];
        } else if (arg === "--dry-run") {
            result.dryRun = true;
        } else if (!arg.startsWith("-") && !result.instruction) {
            result.instruction = arg;
        }

        i++;
    }

    return result;
}

function showHelp(): void {
    console.log(`
QA Playwright Plugin - AI-powered browser testing with E2E refactoring

USAGE:
  qa-test "<instruction>"
  qa-test "<instruction>" --output <dir> --base-url <url>
  qa-test "<instruction>" --refactor --repo <path>

ARGUMENTS:
  <instruction>    Test instruction in natural language
                   Example: "Navigate to /login and verify the form appears"

OPTIONS:
  -o, --output     Output directory for artifacts (default: ~/qa-playwright-results)
  -b, --base-url   Base URL for relative paths
  -t, --timeout    Timeout in milliseconds (default: 300000 = 5 minutes)
  -l, --log        Enable verbose logging of agent progress to stderr
  -h, --help       Show this help message

REFACTORING OPTIONS:
  -r, --refactor   Enable E2E refactoring mode (integrates code into target repo)
  --repo <path>    Path to target Playwright repository (required with --refactor)
  --dry-run        Analyze without making changes (for refactor mode)

EXAMPLES:
  # Basic usage - generate raw Playwright code
  qa-test "Go to example.com and verify the heading says 'Example Domain'"
  
  # With base URL
  qa-test "Test login: navigate to /login, enter test@email.com, click submit" \\
    --base-url https://staging.myapp.com \\
    --output ~/test-results

  # E2E Refactoring mode - generate and integrate into existing repo
  qa-test "Login and toggle dark mode" --refactor --repo ~/my-playwright-tests

  # Dry run to preview changes
  qa-test "Test checkout flow" --refactor --repo ~/e2e-tests --dry-run

OUTPUT:
  JSON result printed to stdout:
  {
    "instructions_completed": "yes" | "no",
    "link_to_playwrightscript": "/path/to/generated.spec.ts",
    "error": ["...", "..."]  // Only if failed
  }

REFACTOR OUTPUT (when --refactor is used):
  {
    "success": true | false,
    "rawScriptPath": "/path/to/raw.spec.ts",
    "generatedTestPath": "/path/to/repo/tests/test.spec.ts",
    "modifiedFiles": ["pages/layoutPage.ts", ...],
    "errors": [...]
  }

REQUIREMENTS:
  - GEMINI_API_KEY environment variable set
  - Playwright MCP: npx @playwright/mcp@latest
`);
}

async function main(): Promise<void> {
    // Skip first two args (node and script path)
    const args = process.argv.slice(2);
    const parsed = parseArgs(args);

    if (parsed.help) {
        showHelp();
        process.exit(0);
    }

    if (!parsed.instruction) {
        console.error("Error: No test instruction provided.\n");
        showHelp();
        process.exit(1);
    }

    try {
        // Resolve output directory to absolute path
        const outputDir = path.resolve(parsed.outputDir);

        // Check if refactoring mode
        if (parsed.refactor) {
            if (!parsed.repoPath) {
                console.error("Error: --repo <path> is required when using --refactor mode.\n");
                showHelp();
                process.exit(1);
            }

            const repoPath = path.resolve(parsed.repoPath);

            // Run the refactoring agent
            const result = await runRefactoringAgent({
                instruction: parsed.instruction,
                outputDir,
                repoPath,
                baseUrl: parsed.baseUrl,
                timeout: parsed.timeout,
                verbose: parsed.verbose,
                dryRun: parsed.dryRun,
            }, parsed.verbose ? (type, content) => {
                console.error(`[${type}] ${content}`);
            } : undefined);

            // Output JSON to stdout
            console.log(JSON.stringify({
                success: result.success,
                rawScriptPath: result.rawScriptPath,
                generatedTestPath: result.generatedTestPath,
                modifiedFiles: result.modifiedFiles,
                errors: result.errors,
            }, null, 2));

            // Exit with appropriate code
            process.exit(result.success ? 0 : 1);
        } else {
            // Standard mode - just generate raw code
            const result = await runQATest({
                instruction: parsed.instruction,
                outputDir,
                baseUrl: parsed.baseUrl,
                timeout: parsed.timeout,
                verbose: parsed.verbose,
            });

            // Output JSON to stdout
            console.log(formatOutput(result));

            // Exit with appropriate code
            process.exit(result.instructions_completed === "yes" ? 0 : 1);
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const result = createFailureResult([`Fatal error: ${errorMessage}`]);
        console.log(formatOutput(result));
        process.exit(1);
    }
}

main();

