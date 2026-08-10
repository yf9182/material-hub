import assert from "node:assert/strict";
import test from "node:test";
import {
  chargeImageGeneration,
  ImageGenerationChargeError,
  stableTemplatePointCost,
} from "../lib/image-generation-charges.ts";

function database(row) {
  return {
    prepare() {
      return {
        bind() {
          return { first: async () => row };
        },
      };
    },
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const input = {
  productId: "product",
  materialId: "material",
  taskId: "11111111-1111-4111-8111-111111111111",
  benefitToken: "benefit-token",
};

test("stable template pricing only emits 10 or 20 and is repeatable", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `material-${index}`);
  const first = ids.map(stableTemplatePointCost);
  assert.deepEqual(first, ids.map(stableTemplatePointCost));
  assert.ok(first.every((value) => value === 10 || value === 20));
  assert.ok(first.includes(10));
  assert.ok(first.includes(20));
});

test("charges the authoritative database price and keeps retries idempotent", async () => {
  const requests = [];
  const result = await chargeImageGeneration(
    input,
    {
      DB: database({ id: "material", price: 20, material_config_raw: '{"type":2}' }),
      BENEFIT_CENTER_INTERNAL_API_KEY: "internal-key",
    },
    async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/v1/wallet")) {
        return response({ id: "wallet", availableBalance: 50, heldBalance: 5 });
      }
      return response({ id: "debit", amount: 20, balance: 30, idempotent: true });
    },
  );
  assert.equal(result.charged_points, 20);
  assert.equal(result.available_balance, 25);
  assert.equal(result.idempotent, true);
  const debitBody = JSON.parse(requests[1].init.body);
  assert.equal(debitBody.amount, 20);
  assert.equal(debitBody.idempotencyKey, `pixpaint:image:${input.taskId}:points:v1`);
  assert.equal(debitBody.referenceId, input.taskId);
});

test("does not contact BenefitCenter for a free template", async () => {
  let requests = 0;
  const result = await chargeImageGeneration(
    { ...input, benefitToken: null },
    { DB: database({ id: "material", price: 0, material_config_raw: '{"type":1}' }) },
    async () => { requests += 1; return response({}); },
  );
  assert.equal(result.charged_points, 0);
  assert.equal(requests, 0);
});

test("rejects unavailable and invalidly priced templates", async () => {
  await assert.rejects(
    chargeImageGeneration(input, { DB: database(null) }, async () => response({})),
    (error) => error instanceof ImageGenerationChargeError && error.code === "TEMPLATE_NOT_AVAILABLE",
  );
  await assert.rejects(
    chargeImageGeneration(input, { DB: database({ id: "material", price: null, material_config_raw: '{"type":2}' }) }, async () => response({})),
    (error) => error instanceof ImageGenerationChargeError && error.code === "TEMPLATE_PRICE_INVALID",
  );
});

test("maps insufficient points and expired sessions", async () => {
  const env = {
    DB: database({ id: "material", price: 20, material_config_raw: '{"type":2}' }),
    BENEFIT_CENTER_INTERNAL_API_KEY: "internal-key",
  };
  await assert.rejects(
    chargeImageGeneration(input, env, async (url) => String(url).endsWith("/v1/wallet")
      ? response({ id: "wallet", availableBalance: 10, heldBalance: 0 })
      : response({ error: "insufficient_points", message: "Insufficient points" }, 409)),
    (error) => error instanceof ImageGenerationChargeError
      && error.code === "INSUFFICIENT_POINTS"
      && error.details.required_points === 20
      && error.details.available_balance === 10,
  );
  await assert.rejects(
    chargeImageGeneration(input, env, async () => response({ error: "unauthorized" }, 401)),
    (error) => error instanceof ImageGenerationChargeError && error.code === "BENEFIT_TOKEN_EXPIRED",
  );
});
