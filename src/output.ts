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
    videoPath: string,
    screenshotPath?: string
): QATestResult {
    return {
        instructions_completed: "yes",
        link_to_playwrightscript: scriptPath,
        link_to_video: videoPath,
        link_to_screenshot: screenshotPath,
    };
}

/**
 * Create a failure result
 */
export function createFailureResult(
    errors: string[],
    videoPath: string = "",
    scriptPath: string = "",
    screenshotPath: string = ""
): QATestResult {
    return {
        instructions_completed: "no",
        link_to_playwrightscript: scriptPath,
        link_to_video: videoPath,
        link_to_screenshot: screenshotPath,
        error: errors,
    };
}

/**
 * Parse the agent's output to extract result information
 */
export function parseAgentOutput(output: string): {
    success: boolean;
    scriptContent: string;
    scriptPath: string;
    videoPath: string;
    screenshotPath: string;
    errors: string[];
} {
    const result = {
        success: false,
        scriptContent: "",
        scriptPath: "",
        videoPath: "",
        screenshotPath: "",
        errors: [] as string[],
    };

    // Check for status
    const statusMatch = output.match(/Status:\s*(PASSED|FAILED)/i);
    if (statusMatch) {
        result.success = statusMatch[1].toUpperCase() === "PASSED";
    }

    // Extract script content
    const scriptMatch = output.match(
        /=== PLAYWRIGHT SCRIPT ===\s*\n([\s\S]*?)(?:===|$)/
    );
    if (scriptMatch) {
        result.scriptContent = scriptMatch[1].trim();
        // Clean up markdown code blocks if present
        result.scriptContent = result.scriptContent
            .replace(/^```typescript\n?/m, "")
            .replace(/^```\s*$/m, "")
            .trim();
    }

    // Extract paths from artifacts section
    const scriptPathMatch = output.match(/Script Path:\s*(.+)/i);
    if (scriptPathMatch) {
        result.scriptPath = scriptPathMatch[1].trim();
    }

    const videoPathMatch = output.match(/Video Path:\s*(.+)/i);
    if (videoPathMatch) {
        result.videoPath = videoPathMatch[1].trim();
    }

    const screenshotPathMatch = output.match(/Screenshot Path:\s*(.+)/i);
    if (screenshotPathMatch) {
        result.screenshotPath = screenshotPathMatch[1].trim();
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

// ... (previous code)

/**
 * Generate default paths for artifacts
 */
export function generateArtifactPaths(
    outputDir: string,
    timestamp: string = new Date().toISOString().replace(/[:.]/g, "-")
): { scriptPath: string; videoPath: string; screenshotPath: string } {
    const testDir = path.join(outputDir, `qa-test-${timestamp}`);

    // Ensure the timestamped subdirectory exists
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    return {
        scriptPath: path.join(testDir, "test.spec.ts"),
        videoPath: path.join(testDir, "video.webm"),
        screenshotPath: path.join(testDir, "screenshot.png")
    };
}
