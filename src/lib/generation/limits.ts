export const MODEL_OUTPUT_BUDGETS = Object.freeze({
  plan: 1200,
  generate: 12000,
  repair: 12000,
});
export const MAX_MODEL_CALLS = 3;
export const MAX_REPAIR_CALLS = 1;
export const MAX_RESERVED_OUTPUT_TOKENS =
  MODEL_OUTPUT_BUDGETS.plan +
  MODEL_OUTPUT_BUDGETS.generate +
  MODEL_OUTPUT_BUDGETS.repair;
