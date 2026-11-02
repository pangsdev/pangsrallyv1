const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PangsRallyBeta (free, voucher-gated test season pass)", function () {
  let beta, owner, server, alice, bob;

  // Mirrors the game server: sign keccak256("PangsRallyBeta", chainId, contract, player) as an eth message.
  const voucher = async (signer, player) => {
    const { chainId } = await ethers.provider.getNetwork();
    const hash = ethers.solidityPackedKeccak256(["string", "uint256", "address", "address"], ["PangsRallyBeta", chainId, await beta.getAddress(), player]);
    return signer.signMessage(ethers.getBytes(hash));
  };

  beforeEach(async function () {
    [owner, server, alice, bob] = await ethers.getSigners();
    beta = await (await ethers.getContractFactory("PangsRallyBeta")).deploy(owner.address, server.address, "ipfs://beta.json");
    await beta.waitForDeployment();
  });

  it("mints free (no value) with a valid voucher, once per wallet", async function () {
    const v = await voucher(server, alice.address);
    await expect(beta.connect(alice).mint(v)).to.emit(beta, "Minted").withArgs(alice.address, 1);
    expect(await beta.hasMinted(alice.address)).to.equal(true);
    expect(await beta.ownerOf(1)).to.equal(alice.address);
    expect(await beta.tokenURI(1)).to.equal("ipfs://beta.json");
    await expect(beta.connect(alice).mint(v)).to.be.revertedWith("Already minted");
  });

  it("rejects a voucher made for another wallet or by another signer", async function () {
    await expect(beta.connect(bob).mint(await voucher(server, alice.address))).to.be.revertedWith("Invalid voucher");
    await expect(beta.connect(alice).mint(await voucher(bob, alice.address))).to.be.revertedWith("Invalid voucher");
  });

  it("a pass transferred away still counts for the wallet that minted it", async function () {
    await beta.connect(alice).mint(await voucher(server, alice.address));
    await beta.connect(alice).transferFrom(alice.address, bob.address, 1);
    expect(await beta.hasMinted(alice.address)).to.equal(true);
    expect(await beta.hasMinted(bob.address)).to.equal(false);
  });

  it("owner can close the mint and rotate the signer; others cannot", async function () {
    await expect(beta.connect(alice).setMintOpen(false)).to.be.reverted;
    await beta.setMintOpen(false);
    await expect(beta.connect(alice).mint(await voucher(server, alice.address))).to.be.revertedWith("Mint is closed");
    await beta.setMintOpen(true);
    await beta.setVoucherSigner(bob.address);
    await expect(beta.connect(alice).mint(await voucher(server, alice.address))).to.be.revertedWith("Invalid voucher");
    await beta.connect(alice).mint(await voucher(bob, alice.address));
  });
});
