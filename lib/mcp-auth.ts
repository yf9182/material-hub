import { platformEnv } from "./platform-runtime";
import { sha256Hex } from "./material-platform";

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function mcpActor(request: Request) {
  const expected = String(platformEnv().MATERIAL_HUB_MCP_TOKEN_HASH ?? "").trim().toLowerCase();
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!expected || !match?.[1]) return null;
  const received = await sha256Hex(match[1].trim());
  if (!constantTimeEqual(received, expected)) return null;
  return String(platformEnv().MATERIAL_HUB_MCP_ACTOR ?? "mcp-trending").trim() || "mcp-trending";
}
