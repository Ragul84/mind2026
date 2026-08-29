import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const roomId = String(body.roomId ?? "");
    if (!roomId) return json({ success: false, error: "Room id required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: room, error: roomError } = await admin
      .from("quiz_rooms")
      .select("id, creator_id, status, winner_count, prize_splits")
      .eq("id", roomId)
      .maybeSingle();
    if (roomError || !room) return json({ success: false, error: "Room not found" }, 404);
    if (room.creator_id !== authData.user.id) return json({ success: false, error: "Only creator can close room" }, 403);
    if (room.status === "completed") return json({ success: false, error: "Already completed" }, 409);

    const { data: participants, error: participantsError } = await admin
      .from("quiz_room_participants")
      .select("id, user_id, display_name, score, time_taken")
      .eq("room_id", roomId)
      .not("completed_at", "is", null)
      .order("score", { ascending: false })
      .order("time_taken", { ascending: true });

    if (participantsError) return json({ success: false, error: participantsError.message }, 500);

    const splits = Array.isArray(room.prize_splits) ? room.prize_splits : [];
    for (let index = 0; index < (participants || []).length; index++) {
      const participant = participants[index];
      const rank = index + 1;
      const reward = index < Number(room.winner_count) ? Number(splits[index] || 0) : 0;

      await admin
        .from("quiz_room_participants")
        .update({ rank, coin_reward: reward })
        .eq("id", participant.id);

      if (reward > 0 && participant.user_id) {
        await admin.rpc("secure_adjust_user_balance", {
          p_user_id: participant.user_id,
          p_amount: reward,
          p_reason: "quiz_room_prize",
          p_claim_key: `quiz-room-prize:${roomId}:${participant.user_id}:${rank}`,
          p_metadata: { roomId, rank, displayName: participant.display_name },
        });
      }
    }

    await admin
      .from("quiz_rooms")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", roomId);

    return json({ success: true, ranked: participants?.length || 0 });
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
