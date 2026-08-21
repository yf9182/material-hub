import { initialProductId, seedCatalog } from "../../../../../lib/catalog-repository";
import { mcpActor } from "../../../../../lib/mcp-auth";
import { inspectTrendingContext, parseStageForm, previewTemplate, publishTrendingTemplates, stageTrendingTemplate, ensureTrendingCategory, TrendingConflictError } from "../../../../../lib/trending-template-service";

function originOf(request: Request) {
  return new URL(request.url).origin;
}

function jsonError(error: unknown, status = 400) {
  if (error instanceof TrendingConflictError) return Response.json({ error: error.message, conflicts: error.candidates }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

async function authorized(request: Request) {
  const actor = await mcpActor(request);
  if (!actor) return null;
  await seedCatalog();
  return actor;
}

export async function GET(request: Request) {
  const actor = await authorized(request);
  if (!actor) return Response.json({ error: "INVALID_MCP_TOKEN" }, { status: 401 });
  const url = new URL(request.url);
  const op = url.searchParams.get("op") ?? "context";
  try {
    if (op === "context") return Response.json({ data: await inspectTrendingContext(initialProductId, originOf(request)) });
    if (op === "preview") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 3);
      if (!ids.length) return jsonError("缺少 ids");
      return Response.json({ data: await Promise.all(ids.map((id) => previewTemplate(initialProductId, id, originOf(request)))) });
    }
    return jsonError("未知 op");
  } catch (error) {
    return jsonError(error, 404);
  }
}

export async function POST(request: Request) {
  const actor = await authorized(request);
  if (!actor) return Response.json({ error: "INVALID_MCP_TOKEN" }, { status: 401 });
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (String(form.get("action") ?? "") !== "stage") return jsonError("multipart 请求 action 必须是 stage");
      return Response.json({ data: await stageTrendingTemplate(initialProductId, actor, parseStageForm(form), originOf(request)) }, { status: 201 });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "ensure-category") return Response.json({ data: await ensureTrendingCategory(initialProductId, actor) });
    if (action === "publish") return Response.json({ data: await publishTrendingTemplates(initialProductId, actor, Array.isArray(body.items) ? body.items as Array<{ id: string; revision: string }> : [], originOf(request)) });
    return jsonError("未知 action");
  } catch (error) {
    return jsonError(error, 400);
  }
}
