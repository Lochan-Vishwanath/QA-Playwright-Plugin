import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

export class McpRunner {
    private client: Client;
    private transport: StdioClientTransport;

    constructor(command: string, args: string[]) {
        this.transport = new StdioClientTransport({
            command,
            args,
        });

        this.client = new Client(
            {
                name: "qa-playwright-plugin-client",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );
    }

    async connect() {
        await this.client.connect(this.transport);
    }

    async listTools() {
        return await this.client.request({ method: "tools/list" }, ListToolsResultSchema);
    }

    async callTool(name: string, args: any) {
        try {
            return await this.client.request(
                {
                    method: "tools/call",
                    params: {
                        name,
                        arguments: args,
                    },
                },
                CallToolResultSchema
            );
        } catch (error) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: error instanceof Error ? error.message : String(error),
                    },
                ],
            };
        }
    }

    async cleanup() {
        try {
            await this.client.close();
        } catch (error) {
            console.error("Error closing MCP client:", error);
        }
    }
}
