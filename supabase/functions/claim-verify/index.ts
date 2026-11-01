import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ethers } from "npm:ethers@6";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { walletAddress, raceId, position, amount } = await req.json();

    if (!walletAddress || !raceId || !position || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Verify race and position in database
    const { data: participant, error: dbError } = await supabase
      .from('race_participants')
      .select('*, races(*)')
      .eq('race_id', raceId)
      .eq('wallet_address', walletAddress.toLowerCase())
      .single();

    if (dbError || !participant) {
      console.error("DB Error:", dbError);
      return new Response(JSON.stringify({ error: "Participant not found" }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (participant.position !== position) {
      return new Response(JSON.stringify({ error: "Position mismatch" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (participant.prize_claimed) {
      return new Response(JSON.stringify({ error: "Prize already claimed" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Generate ECDSA Signature
    const privateKey = Deno.env.get('TREASURY_PRIVATE_KEY');
    if (!privateKey) {
      throw new Error("TREASURY_PRIVATE_KEY not configured in Edge Function");
    }

    const wallet = new ethers.Wallet(privateKey);
    const amountWei = ethers.parseEther(amount.toString());
    
    // Generate a secure nonce (e.g., from DB or random integer)
    // For simplicity, we use timestamp as nonce here, but in production
    // a sequence or UUID mapped to uint256 is better. 
    // We'll use the participant ID integer mapping or just timestamp
    const nonce = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);

    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'uint256'],
      [walletAddress, amountWei, nonce]
    );

    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    // 4. Return to client
    return new Response(
      JSON.stringify({
        amountWei: amountWei.toString(),
        nonce,
        signature
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error("Edge Function Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
