#!/usr/bin/env node
/**
 * QA Playwright Plugin CLI
 * 
 * Usage:
 *   npx qa-playwright "Test instruction"
 *   npx qa-playwright "Navigate to /login and verify form appears" --output ~/results
 *   npx qa-playwright "Test checkout flow" --base-url https://staging.myapp.com
 */

import { runQATest } from "../src/runner";
import { formatOutput, createFailureResult } from "../src/output";
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
} {
    const result = {
        instruction: "",
        outputDir: path.join(os.homedir(), "qa-playwright-results"),
        baseUrl: undefined as string | undefined,
        timeout: 300000, // 5 minutes default
        verbose: false,
        help: false,
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
        } else if (!arg.startsWith("-") && !result.instruction) {
            result.instruction = arg;
        }

        i++;
    }

    return result;
}

function showHelp(): void {
    console.log(`
QA Playwright Plugin - AI-powered browser testing

USAGE:
  qa-test "<instruction>"
  qa-test "<instruction>" --output <dir> --base-url <url>

ARGUMENTS:
  <instruction>    Test instruction in natural language
                   Example: "Navigate to /login and verify the form appears"

OPTIONS:
  -o, --output     Output directory for artifacts (default: ~/qa-playwright-results)
  -b, --base-url   Base URL for relative paths
  -t, --timeout    Timeout in milliseconds (default: 300000 = 5 minutes)
  -l, --log        Enable verbose logging of agent progress to stderr
  -h, --help       Show this help message

EXAMPLES:
  qa-test "Go to example.com and verify the heading says 'Example Domain'"
  
  qa-test "Test login: navigate to /login, enter test@email.com, click submit" \\
    --base-url https://staging.myapp.com \\
    --output ~/test-results

OUTPUT:
  JSON result printed to stdout:
  {
    "instructions_completed": "yes" | "no",
    "link_to_playwrightscript": "/path/to/generated.spec.ts",
    "link_to_video": "/path/to/recording.webm",
    "error": ["...", "..."]  // Only if failed
  }

REQUIREMENTS:
  - OpenCode must be installed and configured
  - Playwright MCP with recording: npx @playwright/record-mcp@latest --record
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

        // Run the QA test
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
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const result = createFailureResult([`Fatal error: ${errorMessage}`]);
        console.log(formatOutput(result));
        process.exit(1);
    }
}

main();
