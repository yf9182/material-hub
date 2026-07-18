import { categoryTree, productByPid, seedCatalog } from "../../../../../../lib/catalog-repository";
import { fail, matchesProductContext, ok, pageParams } from "../../../../../../lib/material-platform";
import { requireApiProduct } from "../../../../../../lib/platform-runtime";

export async function GET(request: Request) {
  const url = new URL(request.url); const pid = url.searchParams.get("pid") ?? "";
  try {
    await seedCatalog();
    if (!await requireApiProduct(request, pid)) return fail("INVALID_API_KEY", 401, "API Key 无效");
    const product = await productByPid(pid); if (!product) return fail("PRODUCT_NOT_FOUND", 404, "产品不存在");
    if (!matchesProductContext(url, product)) return fail("PRODUCT_CONTEXT_MISMATCH", 400, "channel 或 source 与产品不匹配");
    const { page, pageSize } = pageParams(url); const tree = await categoryTree(product);
    return ok({ list: tree.slice((page - 1) * pageSize, page * pageSize), pager: { page, page_size: pageSize, total: tree.length } });
  } catch (error) { return fail("INTERNAL_ERROR", 500, error instanceof Error ? error.message : "服务异常"); }
}
