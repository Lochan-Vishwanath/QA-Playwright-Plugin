import { createOpencode } from "@opencode-ai/sdk";
import type { CLIOptions, QATestResult } from "./types";
import { generateQAPrompt } from "./agent";
import {
    formatOutput,
    createSuccessResult,
    createFailureResult,
    parseAgentOutput,
    generateArtifactPaths,
} from "./output";
import * as fs from "fs";
import * as path from "path";

const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes default

interface EventState {
    idle: boolean;
    error: boolean;
    lastError: string;
    messageContent: string;
}

/**
 * Run the QA test with given options
 */
export async function runQATest(options: CLIOptions): Promise<QATestResult> {
    const { instruction, outputDir, baseUrl, timeout = DEFAULT_TIMEOUT_MS, verbose = false } = options;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Set up timeout
    if (timeout > 0) {
        timeoutId = setTimeout(() => {
            abortController.abort();
        }, timeout);
    }

    try {
        // Start opencode
        const { client, server } = await createOpencode({
            signal: abortController.signal,
            port: 0,
        });

        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            server.close();
        };

        try {
            // Create session
            const sessionRes = await client.session.create({
                body: { title: "QA Playwright Test" },
            });

            const sessionID = sessionRes.data?.id;
            if (!sessionID) {
                cleanup();
                return createFailureResult(["Failed to create opencode session"]);
            }

            // Subscribe to events
            const events = await client.event.subscribe();
            const eventState: EventState = {
                idle: false,
                error: false,
                lastError: "",
                messageContent: "",
            };

            // Start processing events in background
            const eventPromise = processEvents(events.stream, eventState, abortController.signal, verbose);

            // Generate the QA prompt
            const prompt = generateQAPrompt(instruction, outputDir, baseUrl);

            // Send prompt
            await client.session.promptAsync({
                path: { id: sessionID },
                body: {
                    parts: [{ type: "text", text: prompt }],
                },
                query: { directory: process.cwd() },
            });

            // Wait for completion
            while (!abortController.signal.aborted) {
                await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

                if (eventState.idle || eventState.error) {
                    break;
                }
            }

            // Stop event processing
            abortController.abort();
            await eventPromise.catch(() => { });

            cleanup();

            // Parse the agent's output
            const parsed = parseAgentOutput(eventState.messageContent);
            const { scriptPath, videoPath, screenshotPath } = generateArtifactPaths(outputDir);

            // Save script if content was generated
            if (parsed.scriptContent) {
                const finalScriptPath = parsed.scriptPath || scriptPath;
                fs.writeFileSync(finalScriptPath, parsed.scriptContent, "utf-8");
                parsed.scriptPath = finalScriptPath;
            }

            // Return result
            if (eventState.error) {
                return createFailureResult(
                    [eventState.lastError, ...parsed.errors],
                    parsed.videoPath || videoPath,
                    parsed.scriptPath,
                    parsed.screenshotPath || screenshotPath
                );
            }

            if (parsed.success) {
                return createSuccessResult(
                    parsed.scriptPath || scriptPath,
                    parsed.videoPath || videoPath,
                    parsed.screenshotPath || screenshotPath
                );
            }

            return createFailureResult(
                parsed.errors.length > 0 ? parsed.errors : ["Test execution did not complete successfully"],
                parsed.videoPath || videoPath,
                parsed.scriptPath,
                parsed.screenshotPath || screenshotPath
            );
        } catch (err) {
            cleanup();
            throw err;
        }
    } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);

        if (err instanceof Error && err.name === "AbortError") {
            return createFailureResult(["Test execution timed out"]);
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        return createFailureResult([`Execution error: ${errorMessage}`]);
    }
}

/**
 * Process events from opencode
 */
async function processEvents(
    stream: AsyncIterable<{ type: string; properties?: Record<string, unknown> }>,
    state: EventState,
    signal: AbortSignal,
    verbose: boolean = false
): Promise<void> {
    try {
        for await (const event of stream) {
            if (signal.aborted) break;

            // Track message updates to capture agent output
            if (event.type === "message.updated") {
                const props = event.properties as Record<string, unknown> | undefined;
                const info = props?.info as Record<string, unknown> | undefined;
                const parts = info?.parts as Array<{ type: string; text?: string }> | undefined;

                if (parts) {
                    const textParts = parts
                        .filter((p) => p.type === "text" && p.text)
                        .map((p) => p.text);

                    if (textParts.length > 0) {
                        const newContent = textParts.join("\n");
                        if (verbose && newContent !== state.messageContent) {
                            const added = newContent.substring(state.messageContent.length);
                            if (added) {
                                // Filter out "Thinking:" lines and blocks to reduce noise
                                const cleanAdded = added.replace(/^Thinking:.*(\n|$)/gm, "");
                                if (cleanAdded.trim()) {
                                    process.stderr.write(cleanAdded);
                                }
                            }
                        }
                        state.messageContent = newContent;
                    }
                }
            }

            // Track session idle
            if (event.type === "session.created" || event.type === "session.idle") {
                // Give a small delay before marking idle to capture final messages
                setTimeout(() => {
                    state.idle = true;
                }, 1000);
            }

            // Track errors
            if (event.type === "session.error") {
                const props = event.properties as { error?: unknown } | undefined;
                state.error = true;
                state.lastError = String(props?.error || "Unknown error");
            }
        }
    } catch (err) {
        if (!signal.aborted) {
            state.error = true;
            state.lastError = err instanceof Error ? err.message : String(err);
        }
    }
}

/**
 * Main export
 */
export { runQATest as run };
