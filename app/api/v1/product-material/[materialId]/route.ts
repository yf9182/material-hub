import { materialById, productByPid, seedCatalog } from "../../../../../lib/catalog-repository";
import { fail, matchesProductContext, ok } from "../../../../../lib/material-platform";
import { requireApiProduct } from "../../../../../lib/platform-runtime";

export async function GET(request: Request, context: { params: Promise<{ materialId: string }> }) {
  const url = new URL(request.url);
  const pid = url.searchParams.get("pid") ?? "";
  try {
    await seedCatalog();
    if (!await requireApiProduct(request, pid)) return fail("INVALID_API_KEY", 401, "API Key 无效");
    const product = await productByPid(pid);
    if (!product) return fail("PRODUCT_NOT_FOUND", 404, "产品不存在");
    if (!matchesProductContext(url, product)) return fail("PRODUCT_CONTEXT_MISMATCH", 400, "channel 或 source 与产品不匹配");
    const { materialId } = await context.params;
    if (!materialId.trim()) return fail("MATERIAL_ID_REQUIRED", 400, "素材 ID 不能为空");
    const material = await materialById(product, materialId.trim());
    return material ? ok(material) : fail("MATERIAL_NOT_FOUND", 404, "素材不存在或不可用");
  } catch (error) {
    return fail("INTERNAL_ERROR", 500, error instanceof Error ? error.message : "服务异常");
  }
}
