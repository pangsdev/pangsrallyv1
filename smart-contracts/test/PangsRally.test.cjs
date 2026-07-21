const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PangsRally Genesis Contract", function () {
  let PangsRally;
  let pangsRally;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    PangsRally = await ethers.getContractFactory("PangsRally");
    pangsRally = await PangsRally.deploy();
    await pangsRally.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await pangsRally.owner()).to.equal(owner.address);
    });

    it("Should have max supply of 777", async function () {
      expect(await pangsRally.MAX_SUPPLY()).to.equal(777);
    });

    it("Sale should be inactive by default", async function () {
      expect(await pangsRally.isSaleActive()).to.equal(false);
    });
  });

  describe("Minting", function () {
    it("Should fail if sale is inactive", async function () {
      const mintPrice = await pangsRally.mintPrice();
      await expect(pangsRally.connect(addr1).mint(1, { value: mintPrice }))
        .to.be.revertedWith("Sale is not active");
    });

    it("Should mint successfully when sale is active and exact ETH is sent", async function () {
      await pangsRally.connect(owner).toggleSale();
      const mintPrice = await pangsRally.mintPrice();
      
      await pangsRally.connect(addr1).mint(1, { value: mintPrice });
      expect(await pangsRally.balanceOf(addr1.address)).to.equal(1);
      expect(await pangsRally.totalSupply()).to.equal(1);
    });

    it("Should mint multiple NFTs", async function () {
      await pangsRally.connect(owner).toggleSale();
      const mintPrice = await pangsRally.mintPrice();
      
      await pangsRally.connect(addr1).mint(3, { value: mintPrice * 3n });
      expect(await pangsRally.balanceOf(addr1.address)).to.equal(3);
    });

    it("Should fail if insufficient ETH is sent", async function () {
      await pangsRally.connect(owner).toggleSale();
      const mintPrice = await pangsRally.mintPrice();
      
      await expect(pangsRally.connect(addr1).mint(1, { value: mintPrice - 100n }))
        .to.be.revertedWith("Insufficient ETH sent");
    });
  });
  
  describe("Admin Functions", function () {
    it("Should set BaseURI correctly", async function () {
      await pangsRally.connect(owner).setBaseURI("ipfs://TEST_CID/");
      await pangsRally.connect(owner).toggleSale();
      
      const mintPrice = await pangsRally.mintPrice();
      await pangsRally.connect(addr1).mint(1, { value: mintPrice });
      
      expect(await pangsRally.tokenURI(0)).to.equal("ipfs://TEST_CID/0.json");
    });
  });
});
