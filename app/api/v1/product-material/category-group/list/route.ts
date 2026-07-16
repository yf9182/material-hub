import { materialGroups, productByPid, seedCatalog } from "../../../../../../lib/catalog-repository";
import { fail, matchesProductContext, ok, pageParams } from "../../../../../../lib/material-platform";
import { requireApiProduct } from "../../../../../../lib/platform-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url); const pid = url.searchParams.get("pid") ?? "";
  try {
    await seedCatalog();
    if (!await requireApiProduct(request, pid)) return fail("INVALID_API_KEY", 401, "API Key 无效");
    const product = await productByPid(pid); if (!product) return fail("PRODUCT_NOT_FOUND", 404, "产品不存在");
    if (!matchesProductContext(url, product)) return fail("PRODUCT_CONTEXT_MISMATCH", 400, "channel 或 source 与产品不匹配");
    const ids = (url.searchParams.get("product_material_category_ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (!ids.length) return fail("CATEGORY_IDS_REQUIRED", 400, "请提供二级分类 ID");
    const { page, pageSize } = pageParams(url); return ok({ group: await materialGroups(product, ids, page, pageSize) });
  } catch (error) { return fail("INTERNAL_ERROR", 500, error instanceof Error ? error.message : "服务异常"); }
}
