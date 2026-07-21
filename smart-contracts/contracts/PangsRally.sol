// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a/contracts/ERC721A.sol";
import "erc721a/contracts/extensions/ERC721AQueryable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PangsRally is ERC721A, ERC721AQueryable, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 10000;
    uint256 public constant GEN0_SUPPLY = 1000;
    uint256 public mintPrice = 0.0001 ether;
    uint256 public pangsMintPrice = 100 * 10**18; // Default 100 PANGS

    IERC20 public pangsToken;
    
    // Genetics
    mapping(uint256 => uint256) public breedCount;
    mapping(uint256 => uint256[2]) public childToParents;
    mapping(uint256 => uint256) public pangolinDNA; // New: 256-bit DNA
    
    event Bred(uint256 indexed childId, uint256 indexed parent1Id, uint256 indexed parent2Id, uint256 dna);
    
    bool public isSaleActive = false;
    string private baseTokenURI;

    constructor() ERC721A("Pangs Rally Genesis", "PANGS") Ownable(msg.sender) {}

    // IPFS metadata files start from 1.json, so token IDs must start from 1
    function _startTokenId() internal pure virtual override returns (uint256) {
        return 1;
    }

    // ---- MINTING ---- //
    
    function mint(uint256 quantity) external payable {
        require(isSaleActive, "Sale is not active");
        require(totalSupply() + quantity <= GEN0_SUPPLY, "Gen 0 supply exceeded");
        require(msg.value >= mintPrice * quantity, "Insufficient ETH sent");

        uint256 startId = totalSupply() + 1;
        _mint(msg.sender, quantity);
        
        // Generate pseudo-random DNA for Gen 0s
        for(uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = startId + i;
            // Generate a random 256-bit DNA seed for Gen 0 using block data and token ID
            uint256 dna = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, tokenId)));
            pangolinDNA[tokenId] = dna;
        }
    }

    function mintWithPangs(uint256 quantity) external {
        require(isSaleActive, "Sale is not active");
        require(address(pangsToken) != address(0), "PANGS token not set");
        require(totalSupply() + quantity <= GEN0_SUPPLY, "Gen 0 supply exceeded");
        
        uint256 totalCost = pangsMintPrice * quantity;
        require(pangsToken.transferFrom(msg.sender, address(this), totalCost), "PANGS transfer failed");

        uint256 startId = totalSupply() + 1;
        _mint(msg.sender, quantity);
        
        // Generate pseudo-random DNA for Gen 0s
        for(uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = startId + i;
            uint256 dna = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, tokenId)));
            pangolinDNA[tokenId] = dna;
        }
    }
    
    function breed(uint256 parent1Id, uint256 parent2Id) external payable {
        require(isSaleActive, "Sale is not active");
        require(totalSupply() + 1 <= MAX_SUPPLY, "Max supply exceeded");
        require(msg.value >= mintPrice, "Insufficient ETH sent");
        require(ownerOf(parent1Id) == msg.sender, "Must own Parent 1");
        require(ownerOf(parent2Id) == msg.sender, "Must own Parent 2");
        require(parent1Id != parent2Id, "Parents must be different");
        require(breedCount[parent1Id] < 7, "Parent 1 has reached max breeds");
        require(breedCount[parent2Id] < 7, "Parent 2 has reached max breeds");

        breedCount[parent1Id]++;
        breedCount[parent2Id]++;

        uint256 childId = totalSupply() + 1;
        childToParents[childId] = [parent1Id, parent2Id];
        
        // Combine DNA
        uint256 p1DNA = pangolinDNA[parent1Id];
        uint256 p2DNA = pangolinDNA[parent2Id];
        uint256 randomSeed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, childId)));
        
        uint256 childDNA = _combineDNA(p1DNA, p2DNA, randomSeed);
        pangolinDNA[childId] = childDNA;
        
        _mint(msg.sender, 1);
        
        emit Bred(childId, parent1Id, parent2Id, childDNA);
    }
    
    // Internal function to mix DNA using bitwise operations
    // Each trait could be represented by 16 bits
    // 40% chance P1, 40% chance P2, 20% mutation (random seed)
    function _combineDNA(uint256 p1, uint256 p2, uint256 seed) internal pure returns (uint256) {
        uint256 childDna = 0;
        for (uint256 i = 0; i < 16; i++) {
            // Extract 16-bit trait chunks
            uint16 trait1 = uint16(p1 >> (i * 16));
            uint16 trait2 = uint16(p2 >> (i * 16));
            uint16 mutation = uint16(seed >> (i * 16));
            
            // Random choice logic based on seed's next bit
            uint256 choice = (seed >> (256 - (i % 64))) % 100; // Get a pseudo-random number 0-99
            
            uint16 childTrait;
            if (choice < 40) {
                childTrait = trait1;
            } else if (choice < 80) {
                childTrait = trait2;
            } else {
                childTrait = mutation;
            }
            
            // Pack the trait back into the child DNA
            childDna |= (uint256(childTrait) << (i * 16));
        }
        return childDna;
    }

    // ---- ADMIN FUNCTIONS ---- //

    function toggleSale() external onlyOwner {
        isSaleActive = !isSaleActive;
    }

    function setMintPrice(uint256 _price) external onlyOwner {
        mintPrice = _price;
    }

    function setPangsMintPrice(uint256 _price) external onlyOwner {
        pangsMintPrice = _price;
    }

    function setPangsTokenAddress(address _tokenAddress) external onlyOwner {
        pangsToken = IERC20(_tokenAddress);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
    }

    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        payable(owner()).transfer(balance);
    }

    function withdrawPangs() external onlyOwner {
        require(address(pangsToken) != address(0), "PANGS token not set");
        uint256 balance = pangsToken.balanceOf(address(this));
        pangsToken.transfer(owner(), balance);
    }

    // ---- OVERRIDES ---- //

    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }

    // Standard HashLips _metadata.json routing expects .json extension
    mapping(uint256 => string) public pangolinNames;
    event NameChanged(uint256 indexed tokenId, string newName);

    function setName(uint256 tokenId, string memory newName) public {
        require(ownerOf(tokenId) == msg.sender, "Only the owner can name this Pangolin");
        require(bytes(newName).length > 0 && bytes(newName).length <= 25, "Name must be 1-25 characters");
        pangolinNames[tokenId] = newName;
        emit NameChanged(tokenId, newName);
    }

    function tokenURI(uint256 tokenId) public view virtual override(ERC721A, IERC721A) returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        
        string memory baseURI = _baseURI();
        return bytes(baseURI).length != 0 ? string(abi.encodePacked(baseURI, tokenId.toString(), ".json")) : "";
    }
}
