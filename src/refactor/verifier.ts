/**
 * Phase V: Verification Loop
 * 
 * Automatically detect and fix runtime failures through
 * test execution, error classification, and self-correction.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import type {
    TestResult,
    ClassifiedError,
    FixAction,
} from "./types";

// ============================================================================
// Test Execution
// ============================================================================

/**
 * Execute a Playwright test file
 */
export async function runTest(
    testFilePath: string,
    repoRoot: string,
    project: string = "chromium"
): Promise<TestResult> {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let stdout = "";
        let stderr = "";

        const proc = spawn("npx", [
            "playwright",
            "test",
            testFilePath,
            `--project=${project}`,
            "--reporter=line",
        ], {
            cwd: repoRoot,
            shell: true,
        });

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        proc.on("close", (code) => {
            const duration = Date.now() - startTime;
            resolve({
                passed: code === 0,
                stdout,
                stderr,
                duration,
            });
        });

        proc.on("error", (error) => {
            const duration = Date.now() - startTime;
            resolve({
                passed: false,
                stdout,
                stderr: stderr + "\n" + error.message,
                duration,
            });
        });
    });
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Error type detection patterns
 */
const ERROR_PATTERNS: { type: ClassifiedError["type"]; pattern: RegExp; extract?: (match: RegExpMatchArray) => Partial<ClassifiedError> }[] = [
    {
        type: "ElementNotFound",
        pattern: /Timeout (\d+)ms exceeded.*waiting for (.*)/s,
        extract: (match) => ({ message: match[0], locator: match[2] }),
    },
    {
        type: "ElementNotFound",
        pattern: /locator\.(click|fill|type): Timeout.*waiting for element/s,
    },
    {
        type: "ElementIntercepted",
        pattern: /locator\.(click|fill): Element is (intercepted|overlapped)/s,
    },
    {
        type: "ElementIntercepted",
        pattern: /intercepting pointer events/s,
    },
    {
        type: "ElementIntercepted",
        pattern: /MuiBackdrop-root/s,
        extract: () => ({ suggestion: "Wait for backdrop to disappear" }),
    },
    {
        type: "StaleElement",
        pattern: /Element is (stale|detached)/s,
    },
    {
        type: "AssertionFailed",
        pattern: /expect\(received\)\.(toBe|toEqual|toContain|toBeVisible)\((.*)\)/s,
        extract: (match) => ({ message: `Assertion failed: ${match[1]}` }),
    },
    {
        type: "AssertionFailed",
        pattern: /Expected:.*Received:/s,
    },
    {
        type: "Timeout",
        pattern: /Test timeout of (\d+)ms exceeded/s,
    },
];

/**
 * Classify an error from test output
 */
export function classifyError(stderr: string): ClassifiedError {
    for (const { type, pattern, extract } of ERROR_PATTERNS) {
        const match = stderr.match(pattern);
        if (match) {
            const base: ClassifiedError = {
                type,
                message: match[0].substring(0, 200),
            };
            if (extract) {
                return { ...base, ...extract(match) };
            }
            return base;
        }
    }

    return {
        type: "Unknown",
        message: stderr.substring(0, 200),
    };
}

// ============================================================================
// Fix Determination
// ============================================================================

/**
 * Determine the appropriate fix for a classified error
 */
export function determineFix(
    error: ClassifiedError,
    testFilePath: string
): FixAction | null {
    switch (error.type) {
        case "ElementNotFound":
            if (error.locator) {
                return {
                    type: "ADD_WAIT",
                    code: `await ${error.locator}.waitFor({ state: 'visible' });`,
                    targetFile: testFilePath,
                };
            }
            return {
                type: "ADD_WAIT",
                code: "await page.waitForLoadState('networkidle');",
                targetFile: testFilePath,
            };

        case "ElementIntercepted":
            if (error.message.includes("Backdrop") || error.suggestion?.includes("backdrop")) {
                return {
                    type: "ADD_WAIT",
                    code: "await page.waitForSelector('.MuiBackdrop-root', { state: 'hidden' });",
                    targetFile: testFilePath,
                };
            }
            return {
                type: "MODIFY_CLICK",
                code: ".click({ force: true })",
                targetFile: testFilePath,
            };

        case "StaleElement":
            return {
                type: "RE_QUERY",
                code: "// Re-query the element",
                targetFile: testFilePath,
            };

        case "AssertionFailed":
            return {
                type: "ADD_POLL",
                code: "await expect.poll(async () => /* condition */, { timeout: 15000 }).toBeTruthy();",
                targetFile: testFilePath,
            };

        case "Timeout":
            return {
                type: "ADD_WAIT",
                code: "// Consider breaking down the test or increasing timeout",
                targetFile: testFilePath,
            };

        default:
            return null;
    }
}

// ============================================================================
// Fix Application
// ============================================================================

/**
 * Apply a fix to the test file
 * Note: This is a simplified implementation - a full implementation would
 * use AST manipulation for precise modifications
 */
export function applyFix(
    fix: FixAction,
    fileContent: string
): string {
    switch (fix.type) {
        case "ADD_WAIT":
            // Add wait before the first action
            const lines = fileContent.split("\n");
            const testStartIndex = lines.findIndex(l => l.includes("test("));
            if (testStartIndex !== -1) {
                // Find first await after test declaration
                for (let i = testStartIndex + 1; i < lines.length; i++) {
                    if (lines[i].includes("await") && !lines[i].includes("waitFor")) {
                        lines.splice(i, 0, `    ${fix.code}`);
                        break;
                    }
                }
            }
            return lines.join("\n");

        case "MODIFY_CLICK":
            // Replace .click() with .click({ force: true })
            return fileContent.replace(
                /\.click\(\)/g,
                ".click({ force: true })"
            );

        case "ADD_POLL":
            // Replace simple expects with poll-based expects
            return fileContent.replace(
                /await expect\((.*?)\)\.(toBeVisible|toHaveText)\((.*?)\)/g,
                (match, locator, assertion, value) => {
                    return `await expect.poll(async () => await ${locator}.${assertion === 'toBeVisible' ? 'isVisible' : 'textContent'}(), { timeout: 15000 })${assertion === 'toBeVisible' ? '.toBeTruthy()' : `.toBe(${value})`}`;
                }
            );

        default:
            return fileContent;
    }
}

// ============================================================================
// Verification Loop
// ============================================================================

/**
 * Run the verification loop with auto-fix
 */
export async function verifyAndFix(
    testFilePath: string,
    repoRoot: string,
    maxRetries: number = 3,
    verbose: boolean = false
): Promise<{
    passed: boolean;
    attempts: number;
    errors: ClassifiedError[];
    fixes: FixAction[];
}> {
    const errors: ClassifiedError[] = [];
    const fixes: FixAction[] = [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (verbose) {
            console.error(`[VERIFY] Attempt ${attempt}/${maxRetries}...`);
        }

        const result = await runTest(testFilePath, repoRoot);

        if (result.passed) {
            if (verbose) {
                console.error(`[VERIFY] Test passed on attempt ${attempt}`);
            }
            return { passed: true, attempts: attempt, errors, fixes };
        }

        // Classify the error
        const error = classifyError(result.stderr);
        errors.push(error);

        if (verbose) {
            console.error(`[VERIFY] Error: ${error.type} - ${error.message.substring(0, 100)}`);
        }

        // Determine fix
        const fix = determineFix(error, testFilePath);
        if (!fix) {
            if (verbose) {
                console.error(`[VERIFY] No auto-fix available for ${error.type}`);
            }
            break;
        }

        fixes.push(fix);

        // Apply fix
        const content = fs.readFileSync(testFilePath, "utf-8");
        const fixedContent = applyFix(fix, content);
        fs.writeFileSync(testFilePath, fixedContent, "utf-8");

        if (verbose) {
            console.error(`[VERIFY] Applied fix: ${fix.type}`);
        }
    }

    return { passed: false, attempts: maxRetries, errors, fixes };
}

// ============================================================================
// Dry Run Mode
// ============================================================================

/**
 * Analyze test file without executing (for dry-run mode)
 */
export function analyzeTestFile(
    testFilePath: string
): {
    hasValidStructure: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];

    if (!fs.existsSync(testFilePath)) {
        return { hasValidStructure: false, warnings: ["Test file does not exist"] };
    }

    const content = fs.readFileSync(testFilePath, "utf-8");

    // Check for import statement
    if (!content.includes("import { test }")) {
        warnings.push("Missing test import statement");
    }

    // Check for test declaration
    if (!content.includes("test(") && !content.includes("test.describe(")) {
        warnings.push("No test() or test.describe() found");
    }

    // Check for expect
    if (!content.includes("expect(")) {
        warnings.push("No assertions (expect) found in test");
    }

    // Check for async handler
    if (!content.includes("async ({")) {
        warnings.push("Test handler should be async");
    }

    return {
        hasValidStructure: warnings.length === 0,
        warnings,
    };
}
