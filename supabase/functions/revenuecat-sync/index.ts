import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const revenueCatSecretKey = Deno.env.get("REVENUECAT_SECRET_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !revenueCatSecretKey) {
      return json({ success: false, error: "RevenueCat sync is not configured." }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json({ success: false, error: "Authentication required." }, 401);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ success: false, error: "Invalid session." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const entitlementId = String(body.entitlementId || "pro");
    const appUserId = authData.user.id;

    const rcResponse = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${revenueCatSecretKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!rcResponse.ok) {
      const errorText = await rcResponse.text();
      return json({ success: false, error: `RevenueCat verification failed: ${errorText}` }, 502);
    }

    const rcData = await rcResponse.json();
    const entitlement = rcData?.subscriber?.entitlements?.[entitlementId] ?? null;
    const expiresAtText = entitlement?.expires_date ?? null;
    const expiresAt = expiresAtText ? new Date(expiresAtText) : null;
    const isActive = Boolean(entitlement) && (!expiresAt || expiresAt.getTime() > Date.now());
    const productId = entitlement?.product_identifier ?? null;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.rpc("sync_revenuecat_subscription", {
      p_user_id: appUserId,
      p_is_active: isActive,
      p_entitlement_id: entitlementId,
      p_expires_at: expiresAtText,
      p_product_id: productId,
      p_revenuecat_app_user_id: appUserId,
    });

    if (error) {
      return json({ success: false, error: error.message }, 400);
    }

    return json({
      success: true,
      tier: data?.tier ?? (isActive ? "pro" : "free"),
      active: isActive,
      expires_at: expiresAtText,
      product_id: productId,
    });
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
