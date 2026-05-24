import type { RegisteredTool } from "./registry";
import type { ToolRuntimeContext } from "./tool-context";

export function createWebTools(_context: ToolRuntimeContext): RegisteredTool[] {
  return [
    {
      name: "web_search",
      description:
        "搜索互联网获取最新信息。当你需要最新资讯、不确定的知识、实时数据（天气/股价/新闻等）时主动调用。参数 query 为搜索关键词。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词或问题，用简洁的语言描述你想查什么",
          },
        },
        required: ["query"],
      },
      risk: "external_send",
      scopes: ["web"],
      handler: async () =>
        // Anthropic adapter 会把 web_search 转为服务端工具；如果执行到这里，说明当前 provider 不支持该服务端工具。
        JSON.stringify({
          success: false,
          message: "当前模型适配器未接入真实 web_search 服务端工具，不能把这个结果当作联网搜索。",
        }),
    },
  ];
}
