const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const USD = (n) => ethers.parseUnits(String(n), 6);
const CUP = 1;
const [CHAMPION, SECOND, THIRD, FINALIST] = [1, 2, 3, 4];

describe("PangsCup (soulbound Cup badges + USDG prizes)", function () {
  let cup, usd, owner, w, outsider;

  const fund = (n) => usd.mint(cup.target, USD(n));
  // 10 finalists: 15 / 10 / 5 USDG for the podium, badge only for 4th-10th.
  const results = () => [
    w.map((s) => s.address),
    w.map((_, i) => (i === 0 ? CHAMPION : i === 1 ? SECOND : i === 2 ? THIRD : FINALIST)),
    w.map((_, i) => (i === 0 ? USD(15) : i === 1 ? USD(10) : i === 2 ? USD(5) : 0n)),
  ];
  const setResults = (id = CUP) => cup.setResults(id, ...results());
  const after = async (seconds) => { await network.provider.send("evm_increaseTime", [seconds]); await network.provider.send("evm_mine"); };

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, outsider] = signers;
    w = signers.slice(2, 12);
    usd = await (await ethers.getContractFactory("TestUSD")).deploy();
    cup = await (await ethers.getContractFactory("PangsCup")).deploy(owner.address, usd.target);
  });

  it("pays each podium wallet its USDG and mints its badge, once", async function () {
    await fund(30);
    await setResults();
    expect(await cup.totalOwed()).to.equal(USD(30));
    await expect(cup.connect(w[0]).claim(CUP)).to.emit(cup, "Claimed").withArgs(CUP, w[0].address, CHAMPION, USD(15));
    expect(await usd.balanceOf(w[0].address)).to.equal(USD(15));
    expect(await cup.balanceOf(w[0].address, 11)).to.equal(1);
    await cup.connect(w[1]).claim(CUP);
    await cup.connect(w[2]).claim(CUP);
    expect(await usd.balanceOf(w[1].address)).to.equal(USD(10));
    expect(await usd.balanceOf(w[2].address)).to.equal(USD(5));
    expect(await cup.balanceOf(w[1].address, 12)).to.equal(1);
    expect(await cup.balanceOf(w[2].address, 13)).to.equal(1);
    expect(await cup.totalOwed()).to.equal(0);
    expect(await usd.balanceOf(cup.target)).to.equal(0);
    await expect(cup.connect(w[0]).claim(CUP)).to.be.revertedWithCustomError(cup, "AlreadyClaimed");
  });

  it("gives finalists 4-10 the badge and no USDG", async function () {
    await fund(30);
    await setResults();
    await cup.connect(w[9]).claim(CUP);
    expect(await cup.balanceOf(w[9].address, 14)).to.equal(1);
    expect(await usd.balanceOf(w[9].address)).to.equal(0);
  });

  it("refuses wallets that are not finalists, and other Cups", async function () {
    await fund(30);
    await setResults();
    await expect(cup.connect(outsider).claim(CUP)).to.be.revertedWithCustomError(cup, "NotAFinalist");
    await expect(cup.connect(w[0]).claim(2)).to.be.revertedWithCustomError(cup, "NotAFinalist");
    await expect(cup.connect(owner).claim(CUP)).to.be.revertedWithCustomError(cup, "NotAFinalist");
  });

  it("only the owner sets results, only once, and only when funded", async function () {
    await expect(cup.connect(outsider).setResults(CUP, ...results())).to.be.revertedWithCustomError(cup, "OwnableUnauthorizedAccount");
    await fund(29);
    await expect(setResults()).to.be.revertedWithCustomError(cup, "NotFunded");
    await fund(1);
    await setResults();
    await expect(setResults()).to.be.revertedWithCustomError(cup, "ResultsAlreadySet");
    // The same 30 USDG cannot be promised twice.
    await expect(setResults(2)).to.be.revertedWithCustomError(cup, "NotFunded");
  });

  it("rejects bad result lists", async function () {
    await fund(100);
    const [wallets, tiers, amounts] = results();
    await expect(cup.setResults(CUP, [], [], [])).to.be.revertedWithCustomError(cup, "BadResults");
    await expect(cup.setResults(CUP, wallets, tiers.slice(1), amounts)).to.be.revertedWithCustomError(cup, "BadResults");
    await expect(cup.setResults(CUP, [w[0].address, w[0].address], [1, 2], [0, 0])).to.be.revertedWithCustomError(cup, "BadResults");
    await expect(cup.setResults(CUP, [w[0].address], [5], [0])).to.be.revertedWithCustomError(cup, "BadResults");
    await expect(cup.setResults(CUP, [ethers.ZeroAddress], [1], [0])).to.be.revertedWithCustomError(cup, "BadResults");
    const eleven = [...wallets, outsider.address];
    await expect(cup.setResults(CUP, eleven, [...tiers, 4], [...amounts, 0])).to.be.revertedWithCustomError(cup, "BadResults");
  });

  it("badges cannot be transferred or approved", async function () {
    await fund(30);
    await setResults();
    await cup.connect(w[0]).claim(CUP);
    await expect(cup.connect(w[0]).safeTransferFrom(w[0].address, outsider.address, 11, 1, "0x")).to.be.revertedWithCustomError(cup, "Soulbound");
    await expect(cup.connect(w[0]).safeBatchTransferFrom(w[0].address, outsider.address, [11], [1], "0x")).to.be.revertedWithCustomError(cup, "Soulbound");
    await expect(cup.connect(w[0]).setApprovalForAll(outsider.address, true)).to.be.revertedWithCustomError(cup, "Soulbound");
    expect(await cup.locked(11)).to.equal(true);
    expect(await cup.supportsInterface("0xb45a3c0e")).to.equal(true); // ERC-5192
    expect(await cup.supportsInterface("0xd9b67a26")).to.equal(true); // ERC-1155
  });

  it("sweeps unclaimed USDG after 30 days; a late claim still gets the badge", async function () {
    await fund(30);
    await setResults();
    await cup.connect(w[0]).claim(CUP);
    await expect(cup.sweepUnclaimed(CUP)).to.be.revertedWithCustomError(cup, "ClaimWindowOpen");
    await after(30 * 86400 + 1);
    // A late claim before the sweep: badge yes, USDG no, and the sweep still recovers it.
    await cup.connect(w[1]).claim(CUP);
    expect(await cup.balanceOf(w[1].address, 12)).to.equal(1);
    expect(await usd.balanceOf(w[1].address)).to.equal(0);
    await expect(cup.connect(outsider).sweepUnclaimed(CUP)).to.be.revertedWithCustomError(cup, "OwnableUnauthorizedAccount");
    await expect(cup.sweepUnclaimed(CUP)).to.emit(cup, "Swept").withArgs(CUP, USD(15));
    expect(await usd.balanceOf(owner.address)).to.equal(USD(15));
    expect(await cup.totalOwed()).to.equal(0);
    await cup.connect(w[2]).claim(CUP);
    expect(await cup.balanceOf(w[2].address, 13)).to.equal(1);
    expect(await usd.balanceOf(w[2].address)).to.equal(0);
  });

  it("the owner can take back spare USDG but never the promised prizes", async function () {
    await fund(35);
    await setResults();
    await expect(cup.withdrawSpare(USD(6))).to.be.revertedWithCustomError(cup, "NotFunded");
    await cup.withdrawSpare(USD(5));
    expect(await usd.balanceOf(owner.address)).to.equal(USD(5));
    await expect(cup.connect(outsider).withdrawSpare(1)).to.be.revertedWithCustomError(cup, "OwnableUnauthorizedAccount");
    await cup.connect(w[0]).claim(CUP);
    expect(await usd.balanceOf(w[0].address)).to.equal(USD(15));
  });

  it("serves a badge URI per token and reports its details", async function () {
    await cup.setBadgeURI(11, "ipfs://champion.json");
    expect(await cup.uri(11)).to.equal("ipfs://champion.json");
    await expect(cup.connect(outsider).setBadgeURI(11, "x")).to.be.revertedWithCustomError(cup, "OwnableUnauthorizedAccount");
    await fund(30);
    await setResults();
    const [tier, amount, claimed] = await cup.awardOf(CUP, w[1].address);
    expect([tier, amount, claimed]).to.deep.equal([2n, USD(10), false]);
    expect((await cup.finalistsOf(CUP)).length).to.equal(10);
    expect(await cup.name()).to.equal("Pangs Cup Badges");
  });
});

describe("PangsCup Participant badge (Merkle root of the racers)", function () {
  // The same tree code the admin script and the Cup page use (src/testSeason/cupMerkle.ts).
  let merkle, cup, usd, owner, racers, outsider;
  const CUP = 1;
  const PARTICIPANT_ID = 15;

  before(async function () {
    merkle = await import(process.env.CUP_MERKLE || require("path").join(__dirname, "../../src/testSeason/cupMerkle.ts"));
  });

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, outsider] = signers;
    racers = signers.slice(2, 19); // 17: an odd count, so one node moves up unpaired
    usd = await (await ethers.getContractFactory("TestUSD")).deploy();
    cup = await (await ethers.getContractFactory("PangsCup")).deploy(owner.address, usd.target);
  });

  const wallets = () => racers.map((r) => r.address);

  it("lets every racer claim one Participant badge with their own proof", async function () {
    const root = merkle.participantRoot(wallets(), CUP);
    await expect(cup.setParticipants(CUP, root, racers.length)).to.emit(cup, "ParticipantsSet").withArgs(CUP, root, racers.length);
    for (const r of racers) {
      const proof = merkle.participantProof(wallets(), CUP, r.address);
      await expect(cup.connect(r).claimParticipant(CUP, proof)).to.emit(cup, "ParticipantClaimed").withArgs(CUP, r.address);
      expect(await cup.balanceOf(r.address, PARTICIPANT_ID)).to.equal(1);
    }
    const proof0 = merkle.participantProof(wallets(), CUP, racers[0].address);
    await expect(cup.connect(racers[0]).claimParticipant(CUP, proof0)).to.be.revertedWithCustomError(cup, "AlreadyClaimed");
  });

  it("refuses outsiders, borrowed proofs and other Cups", async function () {
    await cup.setParticipants(CUP, merkle.participantRoot(wallets(), CUP), racers.length);
    expect(merkle.participantProof(wallets(), CUP, outsider.address)).to.equal(null);
    const borrowed = merkle.participantProof(wallets(), CUP, racers[3].address);
    await expect(cup.connect(outsider).claimParticipant(CUP, borrowed)).to.be.revertedWithCustomError(cup, "NotAParticipant");
    await expect(cup.connect(racers[3]).claimParticipant(2, borrowed)).to.be.revertedWithCustomError(cup, "NotAParticipant");
  });

  it("is owner-only, set once, and soulbound like the other badges", async function () {
    const root = merkle.participantRoot(wallets(), CUP);
    await expect(cup.connect(outsider).setParticipants(CUP, root, 1)).to.be.revertedWithCustomError(cup, "OwnableUnauthorizedAccount");
    await cup.setParticipants(CUP, root, racers.length);
    await expect(cup.setParticipants(CUP, root, racers.length)).to.be.revertedWithCustomError(cup, "ParticipantsAlreadySet");
    await cup.connect(racers[0]).claimParticipant(CUP, merkle.participantProof(wallets(), CUP, racers[0].address));
    await expect(cup.connect(racers[0]).safeTransferFrom(racers[0].address, outsider.address, PARTICIPANT_ID, 1, "0x"))
      .to.be.revertedWithCustomError(cup, "Soulbound");
  });

  it("works for a one-racer Cup and does not touch the USDG books", async function () {
    const solo = [racers[0].address];
    await cup.setParticipants(CUP, merkle.participantRoot(solo, CUP), 1);
    await cup.connect(racers[0]).claimParticipant(CUP, merkle.participantProof(solo, CUP, racers[0].address));
    expect(await cup.totalOwed()).to.equal(0);
  });
});
