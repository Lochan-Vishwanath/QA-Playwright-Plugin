import { createOpencode } from "@opencode-ai/sdk";
import type { CLIOptions, QATestResult, LogCallback } from "./types";
import { generateQAPrompt } from "./agent";
import {
    formatOutput,
    createSuccessResult,
    createFailureResult,
    parseAgentOutput,
} from "./output";
import * as fs from "fs";
import * as path from "path";

const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes default

/**
 * Check if content should be logged (filter out internal/system messages)
 */
function shouldLogContent(content: string): boolean {
    const lowerContent = content.toLowerCase().trim();
    
    // Skip very short messages (likely internal markers or partial words)
    if (content.length < 20 || lowerContent.length < 10) return false;
    
    // Skip internal system markers and mode indicators
    const skipPatterns = [
        '[analyze-mode]', '[analysis-mode]', '[think]', '[thinking]',
        '[plan-mode]', 'analysis mode', 'thinking process',
        'context gathering', 'synthesize findings',
        'direct tools:', 'explore agents', 'librarian agents', 'consult oracle',
        'parallel:', 'if complex'
    ];
    
    // Check if content starts with or is mostly these markers
    for (const pattern of skipPatterns) {
        if (lowerContent.startsWith(pattern.toLowerCase())) return false;
    }
    
    // Skip if it's a todo list or planning message
    if (lowerContent.includes('todo list') && lowerContent.includes('parallel')) {
        return false;
    }
    
    // Skip very short single-word messages
    if (content.split(/\s+/).length <= 3 && content.length < 50) return false;
    
    return true;
}

interface EventState {
    idle: boolean;
    error: boolean;
    lastError: string;
    messageContent: string;
    logCallback?: LogCallback;
    lastLoggedOutput?: string;
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

    // Generate timestamp and create the test folder at the start
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const testDir = path.join(outputDir, `qa-test-${timestamp}`);

    // Create the test directory immediately
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

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
                logCallback: verbose ? ((type, content) => {
                    if (type === "prompt") {
                        console.error(`[prompt] ${content}`);
                    } else if (type === "output") {
                        console.error(`[output] ${content}`);
                    }
                }) : undefined,
            };

            // Start processing events in background
            const eventPromise = processEvents(events.stream, eventState, abortController.signal);

            // Generate the QA prompt with the test directory
            const prompt = generateQAPrompt(instruction, testDir, baseUrl);

            // Log prompt if verbose logging is enabled
            if (eventState.logCallback) {
                eventState.logCallback("prompt", prompt);
            }

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

            // Use pre-created paths in the timestamped folder
            const scriptPath = path.join(testDir, "test.spec.ts");

            // Save script if content was generated
            if (parsed.scriptContent) {
                const finalScriptPath = parsed.scriptPath || scriptPath;
                fs.writeFileSync(finalScriptPath, parsed.scriptContent, "utf-8");
                parsed.scriptPath = finalScriptPath;
            }

            // Return result
            let result: QATestResult;

            if (eventState.error) {
                result = createFailureResult(
                    [eventState.lastError, ...parsed.errors],
                    parsed.scriptPath || scriptPath
                );
            } else if (parsed.success) {
                result = createSuccessResult(
                    parsed.scriptPath || scriptPath
                );
            } else {
                result = createFailureResult(
                    parsed.errors.length > 0 ? parsed.errors : ["Test execution did not complete successfully"],
                    parsed.scriptPath || scriptPath
                );
            }

            cleanup();
            return result;
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
    signal: AbortSignal
): Promise<void> {
    try {
        // Create an iterator from the stream
        const iterator = stream[Symbol.asyncIterator]();
        
        while (!signal.aborted) {
            // Use Promise.race to allow abort signal to break the loop
            const nextEvent = iterator.next();
            
            const result = await Promise.race([
                nextEvent,
                new Promise<{ done: true }>((resolve) => {
                    // Check abort signal every 500ms
                    const checkInterval = setInterval(() => {
                        if (signal.aborted) {
                            clearInterval(checkInterval);
                            resolve({ done: true });
                        }
                    }, 500);
                })
            ]);
            
            if (result.done || signal.aborted) {
                break;
            }
            
            const event = result.value;

            // Track message updates to capture agent output
            if (event.type === "message.updated" || event.type === "message.part.updated") {
                const props = event.properties as Record<string, unknown> | undefined;

                // Extract text content based on event type
                let textContent = "";

                if (event.type === "message.part.updated") {
                    // For part.updated events, content is in "part.text"
                    const part = props?.part as Record<string, unknown> | undefined;
                    if (part && typeof part.text === "string") {
                        textContent = part.text;
                    }
                } else {
                    // For message.updated events, look for info.parts or info.content
                    const info = props?.info as Record<string, unknown> | undefined;
                    const parts = info?.parts as Array<{ type: string; text?: string }> | undefined;

                    if (parts) {
                        const textParts = parts
                            .filter((p) => p.type === "text" && p.text)
                            .map((p) => p.text);
                        textContent = textParts.join("\n");
                    } else if (typeof info?.content === "string") {
                        // Fallback to info.content if available
                        textContent = info.content;
                    }
                }

                if (textContent) {
                    // Only log substantial content (filter out internal/system messages)
                    if (!shouldLogContent(textContent)) {
                        // Still accumulate the content for parsing, just don't log it
                        if (state.messageContent) {
                            state.messageContent = state.messageContent + "\n" + textContent;
                        } else {
                            state.messageContent = textContent;
                        }
                        continue;
                    }
                    
                    // Skip if content is identical to what we last logged (deduplication)
                    if (state.lastLoggedOutput === textContent) {
                        // Still accumulate the content for parsing
                        if (state.messageContent) {
                            state.messageContent = state.messageContent + "\n" + textContent;
                        } else {
                            state.messageContent = textContent;
                        }
                        continue;
                    }
                    
                    // Log output if verbose logging is enabled
                    if (state.logCallback) {
                        state.logCallback("output", textContent);
                        state.lastLoggedOutput = textContent;
                    }

                    // Accumulate message content - append new parts
                    if (state.messageContent) {
                        state.messageContent = state.messageContent + "\n" + textContent;
                    } else {
                        state.messageContent = textContent;
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
