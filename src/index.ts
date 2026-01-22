/**
 * QA Playwright Plugin
 * 
 * AI-powered Playwright QA testing from natural language instructions.
 * 
 * Usage:
 *   npx qa-playwright "Test instruction here"
 *   npx qa-playwright "Navigate to example.com and verify title" --output ~/results
 */

export { runQATest, run } from "./runner";
export { generateQAPrompt, QA_ENGINEER_SYSTEM_PROMPT, QA_AGENT_CONFIG } from "./agent";
export { formatOutput, createSuccessResult, createFailureResult } from "./output";
export type { QATestResult, CLIOptions, TestStep, TestContext } from "./types";
