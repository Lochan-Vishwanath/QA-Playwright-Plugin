import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { McpRunner } from "./mcp-runner";
import type { LogCallback } from "./types";
import * as dotenv from "dotenv";

dotenv.config();

function sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== "object") return schema;

    const newSchema = { ...schema };
    // Gemini doesn't support these fields in function declarations
    delete newSchema.$schema;
    delete newSchema.additionalProperties;

    if (newSchema.properties) {
        for (const key in newSchema.properties) {
            newSchema.properties[key] = sanitizeSchema(newSchema.properties[key]);
        }
    }

    if (newSchema.items) {
        newSchema.items = sanitizeSchema(newSchema.items);
    }

    return newSchema;
}

export class AgentLoop {
    private genAI: GoogleGenerativeAI;
    private model: any;
    private mcp: McpRunner;
    private logCallback?: LogCallback;
    private history: any[] = [];

    constructor(mcp: McpRunner, logCallback?: LogCallback) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable is not set");
        }

        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({
            model: "gemini-2.5-flash-preview-09-2025",
        });
        this.mcp = mcp;
        this.logCallback = logCallback;
    }

    async run(prompt: string): Promise<string> {
        // Get available tools from MCP
        const toolsResp = await this.mcp.listTools();
        const tools = toolsResp.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeSchema(t.inputSchema)
        }));

        if (this.logCallback) {
            this.logCallback("output", `Available tools: ${tools.map(t => t.name).join(", ")}`);
        }

        // Initialize chat session
        const chat = this.model.startChat({
            generationConfig: {
                temperature: 0.1,
            },
            tools: [
                {
                    functionDeclarations: tools as any
                }
            ]
        });

        let currentParts: any[] = [{ text: prompt }];
        let iteration = 0;
        const maxIterations = 50;

        while (iteration < maxIterations) {
            iteration++;

            if (this.logCallback) {
                this.logCallback("output", `Iteration ${iteration}...`);
            }

            try {
                const result = await chat.sendMessage(currentParts);
                const response = result.response;
                const responseText = response.text();
                const toolCalls = response.functionCalls();

                // Detailed logging of response for debugging
                if (this.logCallback && response) {
                    const candidate = response.candidates?.[0];
                    if (candidate) {
                        const hasTools = toolCalls && toolCalls.length > 0;
                        const textLen = responseText ? responseText.length : 0;
                        this.logCallback("output", `Model Response (Turn ${iteration}): ${hasTools ? '[Has Tool Calls]' : '[No Tool Calls]'} ${textLen > 0 ? `Text: ${responseText.substring(0, 50).replace(/\n/g, ' ')}...` : '[No Text]'}`);
                    }
                }

                if (this.logCallback && responseText) {
                    this.logCallback("output", responseText);
                }

                if (!toolCalls || toolCalls.length === 0) {
                    // Check if the agent has provided the final result
                    if (responseText.includes("=== QA TEST RESULT ===")) {
                        return responseText;
                    }

                    // If it's just a text response, we'll continue for a few iterations 
                    // to see if it eventually decides to use a tool or gives a result.
                    if (iteration >= 5) {
                        return responseText;
                    }

                    // Nudge the model if it's stuck in text-only mode
                    currentParts = [{ text: "Please continue with the next step or provide the final result using the required format." }];
                    continue;
                }

                // Execute tool calls
                const toolResultsParts: any[] = [];
                for (const toolCall of toolCalls) {
                    if (this.logCallback) {
                        this.logCallback("output", `[TOOL CALL] ${toolCall.name}(${JSON.stringify(toolCall.args)})`);
                    }

                    const toolResult = await this.mcp.callTool(toolCall.name, toolCall.args);

                    if (this.logCallback) {
                        const resultText = toolResult.content
                            .filter((c: any) => c.type === "text")
                            .map((c: any) => c.text)
                            .join("\n");
                        this.logCallback("output", `[TOOL RESULT] ${resultText.substring(0, 200)}${resultText.length > 200 ? '...' : ''}`);
                    }

                    toolResultsParts.push({
                        functionResponse: {
                            name: toolCall.name,
                            response: toolResult
                        }
                    });
                }

                // Set current parts for next sendMessage
                currentParts = toolResultsParts;
            } catch (error) {
                if (this.logCallback) {
                    this.logCallback("output", `[ERROR in Loop]: ${error instanceof Error ? error.message : String(error)}`);
                }
                throw error;
            }
        }

        throw new Error("Maximum iterations reached without completion");
    }
}
