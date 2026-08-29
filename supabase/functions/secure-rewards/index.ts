import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ABS_AMOUNT_BY_REASON: Record<string, number> = {
  neural_focus_reward: 500,
  blueprint_completion: 500,
  lesson_reward: 300,
  quiz_completion: 2000,
  study: 1000,
  daily: 1000,
  topic: 2000,
  subject: 2000,
  mission: 3000,
  adaptive: 2000,
  battle: 5000,
  clash_entry: 1000,
  clash_win: 5000,
  clash_win_local: 5000,
  store_purchase: 50000,
  vault_unlock: 50000,
  iap_purchase: 100000,
  general: 1000,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ success: false, error: "Secure rewards are not configured." }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json({ success: false, error: "Authentication required." }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ success: false, error: "Invalid session." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    const reason = String(body.reason ?? "general");
    const claimKey = String(body.claimKey ?? "");
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

    if (!Number.isInteger(amount) || amount === 0) {
      return json({ success: false, error: "Invalid reward amount." }, 400);
    }
    if (!claimKey || claimKey.length < 8 || claimKey.length > 160) {
      return json({ success: false, error: "Invalid reward claim key." }, 400);
    }

    const maxAbsAmount = MAX_ABS_AMOUNT_BY_REASON[reason] ?? MAX_ABS_AMOUNT_BY_REASON.general;
    if (Math.abs(amount) > maxAbsAmount) {
      return json({ success: false, error: "Reward amount exceeds allowed limit." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.rpc("secure_adjust_user_balance", {
      p_user_id: authData.user.id,
      p_amount: amount,
      p_reason: reason,
      p_claim_key: claimKey,
      p_metadata: metadata,
    });

    if (error) {
      return json({ success: false, error: error.message }, 400);
    }

    return json({ success: true, reward: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
