import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CHARS = 160;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
    const voiceId = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "onwK4e9ZLuTAKqWW03F9";
    const modelId = Deno.env.get("ELEVENLABS_MODEL_ID") ?? "eleven_flash_v2_5";
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Announce is not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > MAX_CHARS) {
      return new Response(JSON.stringify({ error: "Invalid text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eleven = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        output_format: "mp3_22050_32",
        voice_settings: {
          stability: 0.38,
          similarity_boost: 0.8,
          speed: 1.12,
        },
      }),
    });

    if (!eleven.ok) {
      const status = eleven.status === 401 || eleven.status === 402 || eleven.status === 429
        ? eleven.status
        : 502;
      return new Response(JSON.stringify({ error: "Voice unavailable" }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(eleven.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Announce failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
