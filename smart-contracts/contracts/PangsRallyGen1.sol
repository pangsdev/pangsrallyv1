// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a/contracts/ERC721A.sol";
import "erc721a/contracts/extensions/ERC721AQueryable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title PangsRally Gen1 & Breeding
 * @notice Mints Gen1 Pangolins by breeding Genesis (OpenSea) or Gen1 NFTs.
 */
contract PangsRallyGen1 is ERC721A, ERC721AQueryable, Ownable, ERC2981 {
    using Strings for uint256;

    // ---------------------------------------------------------------
    // CONSTANTS & STATE
    // ---------------------------------------------------------------
    uint256 public constant MAX_SUPPLY = 20000;
    uint256 public breedPricePangs = 50 * 10**18; // 50 PANGS

    IERC20 public pangsToken;
    IERC721 public genesisContract; // The OpenSea deployed contract
    
    bool public breedingActive = true;

    string private baseTokenURI;

    // Genetics
    mapping(bool => mapping(uint256 => uint256)) public breedCount; // isGenesis => tokenId => count
    mapping(uint256 => uint256) public gen1DNA; // Gen1 DNA storage

    // Custom Names
    mapping(uint256 => string) public pangolinNames;

    event Bred(uint256 indexed childId, bool isP1Gen, uint256 p1Id, bool isP2Gen, uint256 p2Id, uint256 childDNA);
    event NameChanged(uint256 indexed tokenId, string newName);

    // ---------------------------------------------------------------
    // CONSTRUCTOR
    // ---------------------------------------------------------------
    constructor(
        address _pangsToken,
        address _genesisContract,
        address _royaltyReceiver
    ) ERC721A("Pangs Rally Gen 1", "PANGS1") Ownable(msg.sender) {
        pangsToken = IERC20(_pangsToken);
        genesisContract = IERC721(_genesisContract);
        _setDefaultRoyalty(_royaltyReceiver, 500); // 5%
    }

    function _startTokenId() internal pure virtual override returns (uint256) {
        return 1;
    }

    // ---------------------------------------------------------------
    // BREEDING
    // ---------------------------------------------------------------
    function breed(
        bool isP1Genesis, uint256 p1Id,
        bool isP2Genesis, uint256 p2Id
    ) external {
        require(breedingActive, "Breeding paused");
        require(totalSupply() + 1 <= MAX_SUPPLY, "Max supply reached");

        // Cannot breed a token with itself if they are from the same collection
        require(!(isP1Genesis == isP2Genesis && p1Id == p2Id), "Parents must be different");

        // Verify Ownership & Breed limits
        _verifyParent(isP1Genesis, p1Id);
        _verifyParent(isP2Genesis, p2Id);

        // Payment
        require(
            pangsToken.transferFrom(msg.sender, address(this), breedPricePangs),
            "PANGS payment failed"
        );

        // Increment breed counts
        breedCount[isP1Genesis][p1Id]++;
        breedCount[isP2Genesis][p2Id]++;

        // Generate DNA
        uint256 p1DNA = _getDNA(isP1Genesis, p1Id);
        uint256 p2DNA = _getDNA(isP2Genesis, p2Id);
        
        uint256 childId = _nextTokenId();
        uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, childId)));
        
        uint256 childDNA = _combineDNA(p1DNA, p2DNA, seed);
        gen1DNA[childId] = childDNA;

        _mint(msg.sender, 1);
        emit Bred(childId, isP1Genesis, p1Id, isP2Genesis, p2Id, childDNA);
    }

    function _verifyParent(bool isGenesis, uint256 tokenId) internal view {
        if (isGenesis) {
            require(genesisContract.ownerOf(tokenId) == msg.sender, "Must own Genesis parent");
        } else {
            require(ownerOf(tokenId) == msg.sender, "Must own Gen1 parent");
        }
        require(breedCount[isGenesis][tokenId] < 7, "Parent reached max breeds");
    }

    function _getDNA(bool isGenesis, uint256 tokenId) internal view returns (uint256) {
        if (!isGenesis) {
            return gen1DNA[tokenId];
        }
        // Deterministic pseudo-DNA for Genesis tokens
        return uint256(keccak256(abi.encodePacked("GENESIS_DNA_SEED", genesisContract, tokenId)));
    }

    function _combineDNA(uint256 p1, uint256 p2, uint256 seed) internal pure returns (uint256) {
        uint256 childDna = 0;
        for (uint256 i = 0; i < 16; i++) {
            uint16 trait1 = uint16(p1 >> (i * 16));
            uint16 trait2 = uint16(p2 >> (i * 16));
            uint16 mutation = uint16(seed >> (i * 16));
            uint256 choice = (seed >> (256 - (i % 64))) % 100;
            uint16 childTrait = choice < 40 ? trait1 : choice < 80 ? trait2 : mutation;
            childDna |= (uint256(childTrait) << (i * 16));
        }
        return childDna;
    }

    // ---------------------------------------------------------------
    // ADMIN & CONFIG
    // ---------------------------------------------------------------
    function setBreedingActive(bool _active) external onlyOwner {
        breedingActive = _active;
    }

    function setGenesisContract(address _addr) external onlyOwner {
        genesisContract = IERC721(_addr);
    }

    function setBreedPrice(uint256 _price) external onlyOwner {
        breedPricePangs = _price;
    }

    function withdrawPangs() external onlyOwner {
        pangsToken.transfer(owner(), pangsToken.balanceOf(address(this)));
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view virtual override(ERC721A, IERC721A) returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        string memory base = _baseURI();
        return bytes(base).length != 0 ? string(abi.encodePacked(base, tokenId.toString(), ".json")) : "";
    }

    // ---------------------------------------------------------------
    // NAMING
    // ---------------------------------------------------------------
    function setName(uint256 tokenId, string memory newName) public {
        require(ownerOf(tokenId) == msg.sender, "Only owner can name");
        require(bytes(newName).length > 0 && bytes(newName).length <= 25, "Name: 1-25 chars");
        pangolinNames[tokenId] = newName;
        emit NameChanged(tokenId, newName);
    }

    function supportsInterface(bytes4 interfaceId)
        public view virtual override(ERC721A, ERC2981, IERC721A) returns (bool)
    {
        return ERC721A.supportsInterface(interfaceId) || ERC2981.supportsInterface(interfaceId);
    }
}
