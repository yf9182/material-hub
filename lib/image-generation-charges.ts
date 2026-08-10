import type { PlatformEnv } from "./platform-runtime";

type ChargeEnv = Pick<
  PlatformEnv,
  "DB" | "BENEFIT_CENTER_BASE_URL" | "BENEFIT_CENTER_BUNDLE_ID" | "BENEFIT_CENTER_INTERNAL_API_KEY"
>;

type FetchLike = typeof fetch;

type TemplateRow = {
  id: string;
  price: number | null;
  material_config_raw: string;
};

type WalletResponse = {
  id: string;
  availableBalance: number;
  heldBalance: number;
};

type DebitResponse = {
  id: string;
  amount: number;
  balance: number;
  idempotent: boolean;
};

export type ImageGenerationChargeResult = {
  task_id: string;
  material_id: string;
  charged_points: number;
  available_balance: number | null;
  idempotent: boolean;
};

export class ImageGenerationChargeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function stableTemplatePointCost(materialId: string): 10 | 20 {
  const lastCharacter = materialId.at(-1);
  const parity = lastCharacter ? lastCharacter.charCodeAt(0) % 2 : 0;
  return parity === 0 ? 10 : 20;
}

function parseMediaType(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = Number(parsed.type);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

function benefitBaseURL(env: ChargeEnv): string {
  return (env.BENEFIT_CENTER_BASE_URL ?? "https://benefit-center-api.yangf999212.workers.dev")
    .replace(/\/+$/, "");
}

function benefitBundleID(env: ChargeEnv): string {
  return env.BENEFIT_CENTER_BUNDLE_ID?.trim() || "com.hn.PixPaint";
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function walletForToken(
  env: ChargeEnv,
  token: string,
  fetchImpl: FetchLike,
): Promise<WalletResponse> {
  const response = await fetchImpl(`${benefitBaseURL(env)}/v1/wallet`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-bundle-id": benefitBundleID(env),
    },
  });
  if (response.status === 401) {
    throw new ImageGenerationChargeError(401, "BENEFIT_TOKEN_EXPIRED", "积分会话已过期");
  }
  if (!response.ok) {
    throw new ImageGenerationChargeError(503, "BENEFIT_CENTER_UNAVAILABLE", "积分服务暂不可用");
  }
  const body = await responseBody(response);
  if (
    typeof body.id !== "string" ||
    !Number.isInteger(body.availableBalance) ||
    !Number.isInteger(body.heldBalance)
  ) {
    throw new ImageGenerationChargeError(503, "BENEFIT_CENTER_INVALID_RESPONSE", "积分服务响应无效");
  }
  return body as unknown as WalletResponse;
}

async function debitWallet(
  env: ChargeEnv,
  wallet: WalletResponse,
  amount: number,
  taskId: string,
  materialId: string,
  fetchImpl: FetchLike,
): Promise<DebitResponse> {
  const internalKey = env.BENEFIT_CENTER_INTERNAL_API_KEY?.trim();
  if (!internalKey) {
    throw new ImageGenerationChargeError(503, "BENEFIT_CENTER_NOT_CONFIGURED", "积分扣费尚未配置");
  }
  const response = await fetchImpl(`${benefitBaseURL(env)}/internal/v1/debits`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${internalKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      walletId: wallet.id,
      amount,
      idempotencyKey: `pixpaint:image:${taskId}:points:v1`,
      referenceType: "pixpaint_image_template",
      referenceId: taskId,
      description: `PixPaint 图生图模板 ${materialId}`,
    }),
  });
  const body = await responseBody(response);
  const errorCode = typeof body.error === "string" ? body.error : null;
  if (response.status === 409 && errorCode === "insufficient_points") {
    throw new ImageGenerationChargeError(409, "INSUFFICIENT_POINTS", "积分不足", {
      required_points: amount,
      available_balance: wallet.availableBalance,
    });
  }
  if (!response.ok) {
    throw new ImageGenerationChargeError(503, "BENEFIT_CENTER_UNAVAILABLE", "积分服务暂不可用");
  }
  if (
    typeof body.id !== "string" ||
    !Number.isInteger(body.amount) ||
    !Number.isInteger(body.balance) ||
    typeof body.idempotent !== "boolean"
  ) {
    throw new ImageGenerationChargeError(503, "BENEFIT_CENTER_INVALID_RESPONSE", "积分服务响应无效");
  }
  return body as unknown as DebitResponse;
}

export async function chargeImageGeneration(
  input: {
    productId: string;
    materialId: string;
    taskId: string;
    benefitToken: string | null;
  },
  env: ChargeEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ImageGenerationChargeResult> {
  const row = await env.DB.prepare(
    `SELECT m.id, m.price, m.material_config_raw
       FROM materials m
      WHERE m.id = ? AND m.product_id = ?
        AND m.status = 'published' AND m.publish_status = 1 AND m.archived_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM material_categories r
            JOIN categories c ON c.id = r.category_id
           WHERE r.material_id = m.id AND r.product_id = m.product_id
             AND r.listing_status = 1 AND r.archived_at IS NULL
             AND c.parent_id IS NOT NULL AND c.status = 'active' AND c.archived_at IS NULL
        )
      LIMIT 1`,
  ).bind(input.materialId, input.productId).first<TemplateRow>();

  if (!row || ![1, 2].includes(parseMediaType(row.material_config_raw) ?? -1)) {
    throw new ImageGenerationChargeError(404, "TEMPLATE_NOT_AVAILABLE", "图生图模板不存在或不可用");
  }
  const amount = row.price === null || row.price === undefined ? Number.NaN : Number(row.price);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new ImageGenerationChargeError(422, "TEMPLATE_PRICE_INVALID", "模板积分价格无效");
  }
  if (amount === 0) {
    return {
      task_id: input.taskId,
      material_id: input.materialId,
      charged_points: 0,
      available_balance: null,
      idempotent: true,
    };
  }
  const token = input.benefitToken?.trim();
  if (!token) {
    throw new ImageGenerationChargeError(401, "BENEFIT_TOKEN_REQUIRED", "缺少积分会话");
  }
  let wallet: WalletResponse;
  try {
    wallet = await walletForToken(env, token, fetchImpl);
  } catch (error) {
    if (error instanceof ImageGenerationChargeError) throw error;
    throw new ImageGenerationChargeError(503, "BENEFIT_CENTER_UNAVAILABLE", "积分服务暂不可用");
  }
  let debit: DebitResponse;
  try {
    debit = await debitWallet(env, wallet, amount, input.taskId, input.materialId, fetchImpl);
  } catch (error) {
    if (error instanceof ImageGenerationChargeError) throw error;
    throw new ImageGenerationChargeError(503, "BENEFIT_CENTER_UNAVAILABLE", "积分服务暂不可用");
  }
  return {
    task_id: input.taskId,
    material_id: input.materialId,
    charged_points: amount,
    available_balance: debit.balance - wallet.heldBalance,
    idempotent: debit.idempotent,
  };
}
