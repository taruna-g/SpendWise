CREATE TABLE public.spend_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor text NOT NULL,
  category text NOT NULL,
  channel text NOT NULL,
  amount_spent numeric(12,2) NOT NULL CHECK (amount_spent >= 0),
  revenue_generated numeric(12,2) NOT NULL CHECK (revenue_generated >= 0),
  profit numeric(12,2) NOT NULL,
  transaction_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spend_records TO anon, authenticated;
GRANT ALL ON public.spend_records TO service_role;
ALTER TABLE public.spend_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shared fictional demo spend records" ON public.spend_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.budgets (
  id text PRIMARY KEY DEFAULT 'demo' CHECK (id = 'demo'),
  planned_budget numeric(12,2) NOT NULL CHECK (planned_budget >= 0),
  maximum_budget numeric(12,2) NOT NULL CHECK (maximum_budget >= planned_budget),
  alert_threshold numeric(5,2) NOT NULL DEFAULT 80 CHECK (alert_threshold >= 0 AND alert_threshold <= 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO anon, authenticated;
GRANT ALL ON public.budgets TO service_role;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shared fictional demo budget" ON public.budgets FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  additional_budget numeric(12,2) NOT NULL CHECK (additional_budget >= 0),
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allocations) = 'array'),
  estimated_revenue numeric(12,2) NOT NULL DEFAULT 0 CHECK (estimated_revenue >= 0),
  estimated_profit numeric(12,2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'Claude')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.scenarios TO anon, authenticated;
GRANT ALL ON public.scenarios TO service_role;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read fictional demo scenarios" ON public.scenarios FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.save_spend_scenario(
  p_id uuid,
  p_name text,
  p_additional_budget numeric,
  p_allocations jsonb,
  p_estimated_revenue numeric,
  p_estimated_profit numeric,
  p_source text DEFAULT 'website'
) RETURNS public.scenarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_spend numeric;
  maximum_budget numeric;
  allocated_total numeric;
  saved public.scenarios;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Scenario name is required.';
  END IF;
  IF p_additional_budget IS NULL OR p_additional_budget < 0 THEN
    RAISE EXCEPTION 'Additional budget must be zero or more.';
  END IF;
  IF p_estimated_revenue IS NULL OR p_estimated_revenue < 0 OR p_estimated_profit IS NULL THEN
    RAISE EXCEPTION 'Estimated revenue and profit must be valid.';
  END IF;
  IF jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Allocations must be a list.';
  END IF;
  IF p_source NOT IN ('website', 'Claude') THEN
    RAISE EXCEPTION 'Source must be website or Claude.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_allocations) allocation
    WHERE jsonb_typeof(allocation) <> 'object'
      OR coalesce(allocation->>'channel', '') = ''
      OR coalesce(allocation->>'amount', '') !~ '^[0-9]+([.][0-9]+)?$'
  ) THEN
    RAISE EXCEPTION 'Every allocation needs a channel and a non-negative amount.';
  END IF;
  SELECT coalesce(sum((allocation->>'amount')::numeric), 0)
    INTO allocated_total
    FROM jsonb_array_elements(p_allocations) allocation;
  IF allocated_total > p_additional_budget THEN
    RAISE EXCEPTION 'Channel allocations cannot exceed the additional budget.';
  END IF;

  PERFORM 1 FROM public.budgets WHERE id = 'demo' FOR UPDATE;
  SELECT coalesce(sum(amount_spent), 0) INTO current_spend FROM public.spend_records;
  SELECT b.maximum_budget INTO maximum_budget FROM public.budgets b WHERE b.id = 'demo';
  IF maximum_budget IS NULL THEN
    RAISE EXCEPTION 'The demo budget is not configured.';
  END IF;
  IF p_additional_budget > greatest(0, maximum_budget - current_spend) THEN
    RAISE EXCEPTION 'This scenario exceeds the remaining maximum budget.';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.scenarios (name, additional_budget, allocations, estimated_revenue, estimated_profit, source)
    VALUES (trim(p_name), p_additional_budget, p_allocations, p_estimated_revenue, p_estimated_profit, p_source)
    RETURNING * INTO saved;
  ELSE
    UPDATE public.scenarios
      SET name = trim(p_name), additional_budget = p_additional_budget,
          allocations = p_allocations, estimated_revenue = p_estimated_revenue,
          estimated_profit = p_estimated_profit, source = p_source, updated_at = now()
      WHERE id = p_id
      RETURNING * INTO saved;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Scenario was not found.';
    END IF;
  END IF;
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_spend_scenario(uuid, text, numeric, jsonb, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_spend_scenario(uuid, text, numeric, jsonb, numeric, numeric, text) TO anon, authenticated;
