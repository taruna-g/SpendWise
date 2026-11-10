import { describe, expect, it } from "vitest";

import {
  calculateChannelPerformance,
  calculateTotals,
  estimateScenario,
  validateScenarioInput,
  type SpendRecord,
} from "@/lib/spendwise/metrics";

const sample: SpendRecord[] = [
  {
    id: "1",
    vendor: "SearchPilot Media",
    category: "Paid search",
    channel: "Google Ads",
    amount_spent: 100,
    revenue_generated: 300,
    profit: 120,
    transaction_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "2",
    vendor: "NurtureFlow",
    category: "Email campaigns",
    channel: "Email Marketing",
    amount_spent: 50,
    revenue_generated: 200,
    profit: 100,
    transaction_date: "2026-09-02",
    created_at: "2026-09-02T00:00:00.000Z",
  },
];

describe("SpendWise calculations", () => {
  it("totals spending, revenue, and profit across saved records", () => {
    expect(calculateTotals(sample)).toEqual({ spending: 150, revenue: 500, profit: 220 });
  });

  it("uses channel history to estimate the requested ₹50,000 allocation", () => {
    const performance = calculateChannelPerformance(sample);
    expect(
      estimateScenario(
        [
          { channel: "Google Ads", amount: 30_000 },
          { channel: "Email Marketing", amount: 20_000 },
        ],
        performance,
      ),
    ).toEqual({ revenue: 170_000, profit: 56_000 });
  });

  it("rejects an allocation above the remaining maximum budget", () => {
    expect(() => validateScenarioInput(612_601, [], 612_600)).toThrow(
      "This scenario exceeds the remaining maximum budget.",
    );
  });

  it("rejects channel allocations that exceed the additional budget", () => {
    expect(() =>
      validateScenarioInput(50_000, [{ channel: "Google Ads", amount: 50_001 }], 612_600),
    ).toThrow("Channel allocations cannot exceed the additional budget.");
  });
});