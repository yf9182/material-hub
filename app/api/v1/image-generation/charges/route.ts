import { chargeImageGeneration, ImageGenerationChargeError } from "../../../../../lib/image-generation-charges";
import { fail, ok } from "../../../../../lib/material-platform";
import { platformEnv, requireApiProduct } from "../../../../../lib/platform-runtime";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    body = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return fail("INVALID_REQUEST", 400, "请求体必须是合法 JSON");
  }

  const pid = String(body.pid ?? "").trim();
  const materialId = String(body.material_id ?? "").trim();
  const taskId = String(body.task_id ?? "").trim();
  if (!pid || !materialId || !uuidPattern.test(taskId)) {
    return fail("INVALID_REQUEST", 400, "pid、material_id 或 task_id 无效");
  }

  const product = await requireApiProduct(request, pid);
  if (!product) return fail("INVALID_API_KEY", 401, "API Key 无效");

  try {
    const result = await chargeImageGeneration(
      {
        productId: String(product.id),
        materialId,
        taskId,
        benefitToken: request.headers.get("x-benefit-center-token"),
      },
      platformEnv(),
    );
    return ok(result);
  } catch (error) {
    if (error instanceof ImageGenerationChargeError) {
      return Response.json(
        { code: 0, data: { error: error.code, ...error.details }, msg: error.message },
        { status: error.status },
      );
    }
    return fail("INTERNAL_ERROR", 500, "服务异常");
  }
}
