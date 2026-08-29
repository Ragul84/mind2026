import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FEATURES = new Set([
  "miga_message",
  "miga_call",
  "study_lab_generation",
  "study_lab_podcast",
  "blueprint_generate",
  "quiz_room_generate",
  "quiz_sprint_generate",
]);

const FOUNDER_PRO_PHONES = new Set(["8220949220", "918220949220"]);
const UNLIMITED_LIMIT = 999999;
const normalizePhoneDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const isFounderProPhone = (value: unknown) => FOUNDER_PRO_PHONES.has(normalizePhoneDigits(value));

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ success: false, error: "Server AI usage gate is not configured." }, 500);
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
    const feature = String(body.feature ?? "");
    const consume = body.consume === true;

    if (!FEATURES.has(feature)) {
      return json({ success: false, error: "Invalid AI feature." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("phone_number, subscription_tier")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (isFounderProPhone(profile?.phone_number)) {
      return json({
        success: true,
        usage: {
          feature,
          tier: "pro",
          used: 0,
          limit: UNLIMITED_LIMIT,
          remaining: UNLIMITED_LIMIT,
          allowed: true,
          unlimited: true,
          date: new Date().toISOString().slice(0, 10),
        },
      });
    }

    const { data, error } = await adminClient.rpc("check_and_consume_ai_usage", {
      p_user_id: authData.user.id,
      p_feature: feature,
      p_consume: consume,
    });

    if (error) {
      return json({ success: false, error: error.message }, 500);
    }

    return json({ success: true, usage: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
