import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VAULT_REWARDS: Record<string, number> = {
  polity: 500,
  science: 350,
  history: 450,
  geography: 300,
  economy: 1200,
  "current-affairs": 2500,
  general: 5000,
};

const MULTIPLIERS: Record<number, number> = { 1: 1, 2: 0.6, 3: 0.4, 4: 0.2 };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ success: false, error: "Not configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ success: false, error: "Authentication required" }, 401);

    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ success: false, error: "Invalid session" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId ?? "");
    if (!sessionId) return json({ success: false, error: "Session id required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: session, error: sessionError } = await admin
      .from("game_sessions")
      .select("id, vault_id, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError || !session) return json({ success: false, error: "Session not found" }, 404);

    const { data: caller } = await admin
      .from("game_participants")
      .select("id")
      .eq("game_session_id", sessionId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (!caller) return json({ success: false, error: "Not a participant" }, 403);

    const { data: participants, error: participantsError } = await admin
      .from("game_participants")
      .select("id, user_id, score, user_name")
      .eq("game_session_id", sessionId)
      .order("score", { ascending: false });
    if (participantsError || !participants?.length) return json({ success: false, error: "No participants" }, 404);

    const baseReward = VAULT_REWARDS[session.vault_id] ?? 500;
    let callerResult: any = null;

    for (let index = 0; index < participants.length; index++) {
      const participant = participants[index];
      const rank = index + 1;
      const earned = Math.floor(baseReward * (MULTIPLIERS[rank] ?? 0.1));

      await admin
        .from("game_participants")
        .update({
          final_rank: rank,
          mg_earned: earned,
          xp_earned: earned,
          finished_at: new Date().toISOString(),
        })
        .eq("id", participant.id);

      await admin.rpc("secure_adjust_user_balance", {
        p_user_id: participant.user_id,
        p_amount: earned,
        p_reason: "clash_win",
        p_claim_key: `heist-complete:${sessionId}:${participant.user_id}:${rank}`,
        p_metadata: { sessionId, rank, score: participant.score },
      });

      await admin.rpc("update_player_leaderboard", { p_user_id: participant.user_id });

      if (participant.user_id === authData.user.id) {
        callerResult = {
          rank,
          score: participant.score,
          mgEarned: earned,
          xpEarned: earned,
          insight: "Verified battle result recorded.",
        };
      }
    }

    await admin
      .from("game_sessions")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", sessionId);

    return json({ success: true, result: callerResult });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
