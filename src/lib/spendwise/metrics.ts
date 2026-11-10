import type { Tables } from "@/integrations/supabase/types";

export const CHANNELS = [
  "Google Ads",
  "Meta Ads",
  "Influencer Marketing",
  "Email Marketing",
] as const;

export type Channel = (typeof CHANNELS)[number];
export type SpendRecord = Tables<"spend_records">;
export type SpendRecordInput = Tables<"spend_records"> extends never
  ? never
  : Omit<Tables<"spend_records">, "id" | "created_at">;
export type Scenario = Tables<"scenarios">;
export type ScenarioAllocation = { channel: Channel; amount: number };
export type ChannelPerformance = {
  channel: Channel;
  spend: number;
  revenue: number;
  profit: number;
  roas: number;
  profitMargin: number;
  records: number;
};

export function calculateTotals(records: readonly SpendRecord[]) {
  return records.reduce(
    (totals, record) => ({
      spending: totals.spending + Number(record.amount_spent),
      revenue: totals.revenue + Number(record.revenue_generated),
      profit: totals.profit + Number(record.profit),
    }),
    { spending: 0, revenue: 0, profit: 0 },
  );
}

export function calculateChannelPerformance(records: readonly SpendRecord[]) {
  return CHANNELS.map((channel): ChannelPerformance => {
    const matching = records.filter((record) => record.channel === channel);
    const totals = calculateTotals(matching);
    return {
      channel,
      spend: totals.spending,
      revenue: totals.revenue,
      profit: totals.profit,
      roas: totals.spending ? totals.revenue / totals.spending : 0,
      profitMargin: totals.revenue ? totals.profit / totals.revenue : 0,
      records: matching.length,
    };
  });
}

export function validateScenarioInput(
  additionalBudget: number,
  allocations: readonly ScenarioAllocation[],
  remainingMaximum: number,
) {
  if (!Number.isFinite(additionalBudget) || additionalBudget < 0) {
    throw new Error("Additional budget must be zero or more.");
  }
  if (!Number.isFinite(remainingMaximum) || remainingMaximum < 0) {
    throw new Error("The remaining maximum budget is unavailable.");
  }
  if (additionalBudget > remainingMaximum) {
    throw new Error("This scenario exceeds the remaining maximum budget.");
  }
  let allocated = 0;
  for (const allocation of allocations) {
    if (!CHANNELS.includes(allocation.channel)) {
      throw new Error(`Unknown channel: ${allocation.channel}.`);
    }
    if (!Number.isFinite(allocation.amount) || allocation.amount < 0) {
      throw new Error("Each channel allocation must be zero or more.");
    }
    allocated += allocation.amount;
  }
  if (allocated > additionalBudget) {
    throw new Error("Channel allocations cannot exceed the additional budget.");
  }
}

export function estimateScenario(
  allocations: readonly ScenarioAllocation[],
  performance: readonly ChannelPerformance[],
) {
  return allocations.reduce(
    (estimate, allocation) => {
      const channel = performance.find((item) => item.channel === allocation.channel);
      if (!channel) return estimate;
      return {
        revenue: estimate.revenue + allocation.amount * channel.roas,
        profit: estimate.profit + allocation.amount * (channel.spend ? channel.profit / channel.spend : 0),
      };
    },
    { revenue: 0, profit: 0 },
  );
}

export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}