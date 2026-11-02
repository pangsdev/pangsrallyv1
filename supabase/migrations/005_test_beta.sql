-- Test season Beta pass: racing needs the free Beta NFT (smart-contracts/contracts/PangsRallyBeta.sol).
-- The server asks the chain until it sees the mint, then remembers it here.
alter table test_players add column if not exists beta_minted_at timestamptz;
