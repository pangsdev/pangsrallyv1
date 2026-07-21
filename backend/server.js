require('dotenv').config({ path: '../smart-contracts/.env' });
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// --- Database Setup ---
const db = new sqlite3.Database('./pangs_racing.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS races (
      id TEXT PRIMARY KEY,
      map TEXT,
      status TEXT,
      seed TEXT,
      participants INTEGER,
      winnerAddress TEXT,
      date TEXT
    )`);
  }
});

// --- Wallet Setup ---
const privateKey = process.env.PRIVATE_KEY; 
if (!privateKey) {
  console.error("FATAL: No PRIVATE_KEY found in .env");
  process.exit(1);
}
const wallet = new ethers.Wallet(privateKey);
console.log("Backend Signer Address:", wallet.address);

// --- API Endpoints ---

// 1. Join a Race
app.post('/api/race/join', (req, res) => {
  const { playerAddress, map, nftData } = req.body;
  if (!playerAddress || !map) return res.status(400).json({ error: "Missing parameters" });

  // For MVP, we simply generate a new race immediately with 10 participants (player + 9 bots)
  // In production, we would add the player to a waiting room until it reaches 10 players.
  
  const raceId = 'RC-' + Math.floor(Math.random() * 90000 + 10000);
  const seed = ethers.hexlify(ethers.randomBytes(32)); // 32 byte random seed
  const date = new Date().toISOString();

  const stmt = db.prepare(`INSERT INTO races (id, map, status, seed, participants, winnerAddress, date) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  stmt.run(raceId, map, 'completed', seed, 10, null, date, function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ success: true, raceId, seed });
  });
  stmt.finalize();
});

// 2. Fetch Race History (for Replays)
app.get('/api/race/history', (req, res) => {
  // Return all races for now (in production, filter by address)
  db.all(`SELECT * FROM races ORDER BY date DESC LIMIT 20`, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});

// 3. Claim Prize
let claimNonce = 1;
app.post('/api/claim', async (req, res) => {
  const { playerAddress, amount } = req.body;
  if (!playerAddress || !amount) {
    return res.status(400).json({ error: "Missing playerAddress or amount" });
  }

  try {
    const amountWei = ethers.parseEther(amount.toString());
    const nonce = claimNonce++; 
    
    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'uint256'],
      [playerAddress, amountWei, nonce]
    );
    
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));
    
    res.json({ success: true, amountWei: amountWei.toString(), nonce, signature });
  } catch (err) {
    console.error("Error generating signature:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
