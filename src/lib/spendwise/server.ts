import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { CHANNELS } from "./metrics";
import { supabaseAnon } from "./db";

const idSchema = z.string().uuid();
const nonNegativeAmount = z.number().finite().min(0).max(99_999_999_999);
const recordSchema = z.object({
  vendor: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(80),
  channel: z.enum(CHANNELS),
  amount_spent: nonNegativeAmount,
  revenue_generated: nonNegativeAmount,
  profit: z.number().finite().max(99_999_999_999).min(-99_999_999_999),
  transaction_date: z.iso.date(),
});
const allocationSchema = z.array(
  z.object({ channel: z.enum(CHANNELS), amount: nonNegativeAmount }),
).max(4);
const scenarioSchema = z.object({
  name: z.string().trim().min(1).max(100),
  additionalBudget: nonNegativeAmount,
  allocations: allocationSchema,
  estimatedRevenue: nonNegativeAmount,
  estimatedProfit: z.number().finite().min(-99_999_999_999).max(99_999_999_999),
  source: z.enum(["website", "Claude"]).default("website"),
});

export const getSpendWiseData = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = supabaseAnon();
  const [spend, budget, scenarios] = await Promise.all([
    supabase
      .from("spend_records")
      .select("id, vendor, category, channel, amount_spent, revenue_generated, profit, transaction_date, created_at")
      .order("transaction_date", { ascending: false })
      .limit(500),
    supabase.from("budgets").select("id, planned_budget, maximum_budget, alert_threshold, updated_at").eq("id", "demo").single(),
    supabase
      .from("scenarios")
      .select("id, name, additional_budget, allocations, estimated_revenue, estimated_profit, source, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);
  if (spend.error) throw new Error(spend.error.message);
  if (budget.error) throw new Error(budget.error.message);
  if (scenarios.error) throw new Error(scenarios.error.message);
  return { records: spend.data, budget: budget.data, scenarios: scenarios.data };
});

export const saveSpendRecord = createServerFn({ method: "POST" })
  .inputValidator((input: { id?: string; record: unknown }) => {
    const parsed = z.object({ id: idSchema.optional(), record: recordSchema }).parse(input);
    return parsed;
  })
  .handler(async ({ data }) => {
    const supabase = supabaseAnon();
    const query = data.id
      ? supabase.from("spend_records").update(data.record).eq("id", data.id)
      : supabase.from("spend_records").insert(data.record);
    const { data: saved, error } = await query.select("*").single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteSpendRecord = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: idSchema }).parse(input))
  .handler(async ({ data }) => {
    const { error } = await supabaseAnon().from("spend_records").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

export const saveBudgetSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      plannedBudget: nonNegativeAmount,
      maximumBudget: nonNegativeAmount,
      alertThreshold: z.number().finite().min(0).max(100),
    }).refine((value) => value.maximumBudget >= value.plannedBudget, {
      message: "Maximum spending must be at least the planned budget.",
      path: ["maximumBudget"],
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = supabaseAnon();
    const { data: spend, error: spendError } = await supabase
      .from("spend_records")
      .select("amount_spent")
      .limit(500);
    if (spendError) throw new Error(spendError.message);
    const actualSpend = (spend ?? []).reduce((total, item) => total + Number(item.amount_spent), 0);
    if (data.maximumBudget < actualSpend) {
      throw new Error("Maximum spending cannot be below recorded spending.");
    }
    const { data: saved, error } = await supabase
      .from("budgets")
      .update({
        planned_budget: data.plannedBudget,
        maximum_budget: data.maximumBudget,
        alert_threshold: data.alertThreshold,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "demo")
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const saveSpendScenario = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ id: idSchema.optional(), ...scenarioSchema.shape }).parse(input),
  )
  .handler(async ({ data }) => {
    const { id, name, additionalBudget, allocations, estimatedRevenue, estimatedProfit, source } = data;
    const { data: saved, error } = await supabaseAnon().rpc("save_spend_scenario", {
      p_id: id ?? null,
      p_name: name,
      p_additional_budget: additionalBudget,
      p_allocations: allocations,
      p_estimated_revenue: estimatedRevenue,
      p_estimated_profit: estimatedProfit,
      p_source: source,
    });
    if (error) throw new Error(error.message);
    return saved;
  });