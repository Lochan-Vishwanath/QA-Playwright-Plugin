/**
 * QA Test Result Type
 */
export interface QATestResult {
    instructions_completed: "yes" | "no";
    test_status: "passed" | "failed";
    link_to_playwrightscript: string;
    error?: string[];
}

/**
 * CLI Options
 */
export interface CLIOptions {
    instruction: string;
    outputDir: string;
    baseUrl?: string;
    timeout?: number;
    verbose?: boolean;
}

/**
 * Log callback for verbose output
 */
export interface LogCallback {
    (type: "prompt" | "output", content: string): void;
}

/**
 * Parsed Test Step
 */
export interface TestStep {
    action: "navigate" | "click" | "type" | "verify" | "wait" | "screenshot";
    target?: string;
    value?: string;
    expectation?: string;
}

/**
 * Test Execution Context
 */
export interface TestContext {
    sessionID: string;
    outputDir: string;
    baseUrl?: string;
    steps: TestStep[];
    errors: string[];
    scriptPath: string;
}
