import type { QATestResult } from "./types";

/**
 * Format the test result as JSON output
 */
export function formatOutput(result: QATestResult): string {
    return JSON.stringify(result, null, 2);
}

/**
 * Create a success result
 */
export function createSuccessResult(
    scriptPath: string,
    testStatus: "passed" | "failed" = "passed"
): QATestResult {
    return {
        instructions_completed: "yes",
        test_status: testStatus,
        link_to_playwrightscript: scriptPath,
    };
}

/**
 * Create a failure result
 */
export function createFailureResult(
    errors: string[],
    scriptPath: string = "",
    testStatus: "passed" | "failed" = "failed"
): QATestResult {
    return {
        instructions_completed: "no",
        test_status: testStatus,
        link_to_playwrightscript: scriptPath,
        error: errors,
    };
}

/**
 * Parse the agent's output to extract result information
 */
export function parseAgentOutput(output: string): {
    success: boolean;
    testStatus: "passed" | "failed";
    scriptContent: string;
    scriptPath: string;
    errors: string[];
} {
    const result = {
        success: false,
        testStatus: "failed" as "passed" | "failed",
        scriptContent: "",
        scriptPath: "",
        errors: [] as string[],
    };

    // Check for status - look for "Status:" line anywhere in output
    // Pattern matches "Status:" followed by optional whitespace and PASSED/FAILED (with or without emoji)
    // Also handles indented or quoted Status: lines
    const statusMatch = output.match(/Status:\s*([A-Za-z]+)/m);
    if (statusMatch) {
        const status = statusMatch[1].toUpperCase();
        result.success = status === "PASSED";
        result.testStatus = status === "PASSED" ? "passed" : "failed";
    }

    // Extract script content - handle multiple formats
    // Format 1: === PLAYWRIGHT SCRIPT === followed by content
    const scriptMatch = output.match(
        /=== PLAYWRIGHT SCRIPT ===\s*\n([\s\S]*?)(?:\n=== |$)/m
    );
    if (scriptMatch) {
        let content = scriptMatch[1].trim();
        // Clean up markdown code blocks if present
        content = content
            .replace(/^```typescript\n?/m, "")
            .replace(/^```\s*$/m, "")
            .trim();
        // Only set if it's not a placeholder
        if (content && !content.includes("[full script content]") && content.length > 50) {
            result.scriptContent = content;
        }
    }

    // Extract paths from artifacts section - look for the actual paths with backticks at the end of output
    // The agent outputs: **Script Path**: `C:\path\to\file`
    const scriptPathMatch = output.match(/\*\*Script Path\*\*:\s*`([^`]+)`/);
    if (scriptPathMatch) {
        result.scriptPath = scriptPathMatch[1].trim();
    }

    // Extract errors
    const errorsMatch = output.match(/Errors:\s*\n([\s\S]*?)(?:\n\n|===|$)/);
    if (errorsMatch) {
        const errorsBlock = errorsMatch[1];
        const errorLines = errorsBlock
            .split("\n")
            .map((line) => line.replace(/^-\s*/, "").trim())
            .filter((line) => line && line !== "None" && line !== "N/A");
        result.errors = errorLines;
    }

    return result;
}

/**
 * Generate default paths for artifacts
 */
import * as fs from "fs";
import * as path from "path";

/**
 * Generate default paths for artifacts
 */
export function generateArtifactPaths(
    outputDir: string,
    timestamp: string = new Date().toISOString().replace(/[:.]/g, "-")
): { scriptPath: string } {
    const testDir = path.join(outputDir, `qa-test-${timestamp}`);

    // Ensure the timestamped subdirectory exists
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    return {
        scriptPath: path.join(testDir, "test.spec.ts"),
    };
}
