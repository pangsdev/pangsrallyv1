// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a/contracts/ERC721A.sol";
import "erc721a/contracts/extensions/ERC721AQueryable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

/**
 * @title PangsRally Genesis Collection
 * @notice ERC721A + ERC2981 (%5 royalty) + Unrevealed/Reveal mekanizması
 *
 * Unrevealed durumda:
 *   tokenURI(id) → unrevealedURI  (tek gizli görsel, tüm tokenlar)
 *
 * Reveal sonrası:
 *   tokenURI(id) → baseTokenURI + id + ".json"  (her tokenın kendi metadata'sı)
 *
 * Oyun uyumluluğu:
 *   - "Body" attribute (Black/Blue/Gold...) reveal sonrası okunur → doğru sprite
 *   - Reveal öncesi frontend fallback sprite gösterir
 */
contract PangsRally is ERC721A, ERC721AQueryable, Ownable, ERC2981 {
    using Strings for uint256;

    // ---------------------------------------------------------------
    // CONSTANTS & STATE
    // ---------------------------------------------------------------
    uint256 public constant MAX_SUPPLY  = 10000;
    uint256 public constant GEN0_SUPPLY = 1000;

    uint256 public mintPrice      = 0.0001 ether;
    uint256 public pangsMintPrice = 100 * 10**18; // 100 PANGS

    IERC20 public pangsToken;
    bool   public isSaleActive = false;

    // Reveal state
    bool   public revealed       = false;
    string public unrevealedURI;          // IPFS URI — tüm gizli tokenlar için
    string private baseTokenURI;          // Reveal sonrası kullanılır

    // Genetics
    mapping(uint256 => uint256)    public breedCount;
    mapping(uint256 => uint256[2]) public childToParents;
    mapping(uint256 => uint256)    public pangolinDNA;

    // Custom Names
    mapping(uint256 => string) public pangolinNames;

    // ---------------------------------------------------------------
    // EVENTS
    // ---------------------------------------------------------------
    event Bred(uint256 indexed childId, uint256 indexed parent1Id, uint256 indexed parent2Id, uint256 dna);
    event NameChanged(uint256 indexed tokenId, string newName);
    event Revealed(string baseURI);

    // ---------------------------------------------------------------
    // CONSTRUCTOR
    // ---------------------------------------------------------------
    constructor(
        address _royaltyReceiver,
        string memory _unrevealedURI
    )
        ERC721A("Pangs Rally Genesis", "PANGS")
        Ownable(msg.sender)
    {
        unrevealedURI = _unrevealedURI;
        // %5 royalty (500 basis points) → royaltyReceiver
        _setDefaultRoyalty(_royaltyReceiver, 500);
    }

    // Token IDs 1'den başlar (IPFS metadata 1.json'dan)
    function _startTokenId() internal pure virtual override returns (uint256) {
        return 1;
    }

    // ---------------------------------------------------------------
    // MINTING
    // ---------------------------------------------------------------
    function mint(uint256 quantity) external payable {
        require(isSaleActive,                             "Sale is not active");
        require(totalSupply() + quantity <= GEN0_SUPPLY,  "Gen 0 supply exceeded");
        require(msg.value >= mintPrice * quantity,         "Insufficient ETH sent");

        uint256 startId = _nextTokenId();
        _mint(msg.sender, quantity);

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = startId + i;
            pangolinDNA[tokenId] = uint256(
                keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, tokenId))
            );
        }
    }

    function mintWithPangs(uint256 quantity) external {
        require(isSaleActive,                             "Sale is not active");
        require(address(pangsToken) != address(0),        "PANGS token not set");
        require(totalSupply() + quantity <= GEN0_SUPPLY,  "Gen 0 supply exceeded");

        uint256 totalCost = pangsMintPrice * quantity;
        require(pangsToken.transferFrom(msg.sender, address(this), totalCost), "PANGS transfer failed");

        uint256 startId = _nextTokenId();
        _mint(msg.sender, quantity);

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = startId + i;
            pangolinDNA[tokenId] = uint256(
                keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, tokenId))
            );
        }
    }

    function breed(uint256 parent1Id, uint256 parent2Id) external payable {
        require(isSaleActive,                          "Sale is not active");
        require(totalSupply() + 1 <= MAX_SUPPLY,       "Max supply exceeded");
        require(msg.value >= mintPrice,                "Insufficient ETH sent");
        require(ownerOf(parent1Id) == msg.sender,      "Must own Parent 1");
        require(ownerOf(parent2Id) == msg.sender,      "Must own Parent 2");
        require(parent1Id != parent2Id,                "Parents must be different");
        require(breedCount[parent1Id] < 7,             "Parent 1 reached max breeds");
        require(breedCount[parent2Id] < 7,             "Parent 2 reached max breeds");

        breedCount[parent1Id]++;
        breedCount[parent2Id]++;

        uint256 childId = _nextTokenId();
        childToParents[childId] = [parent1Id, parent2Id];

        uint256 p1DNA  = pangolinDNA[parent1Id];
        uint256 p2DNA  = pangolinDNA[parent2Id];
        uint256 seed   = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, childId)));
        uint256 childDNA = _combineDNA(p1DNA, p2DNA, seed);
        pangolinDNA[childId] = childDNA;

        _mint(msg.sender, 1);
        emit Bred(childId, parent1Id, parent2Id, childDNA);
    }

    // DNA mixing — 40% P1, 40% P2, 20% mutation
    function _combineDNA(uint256 p1, uint256 p2, uint256 seed) internal pure returns (uint256) {
        uint256 childDna = 0;
        for (uint256 i = 0; i < 16; i++) {
            uint16 trait1    = uint16(p1   >> (i * 16));
            uint16 trait2    = uint16(p2   >> (i * 16));
            uint16 mutation  = uint16(seed >> (i * 16));
            uint256 choice   = (seed >> (256 - (i % 64))) % 100;
            uint16 childTrait = choice < 40 ? trait1 : choice < 80 ? trait2 : mutation;
            childDna |= (uint256(childTrait) << (i * 16));
        }
        return childDna;
    }

    // ---------------------------------------------------------------
    // REVEAL
    // ---------------------------------------------------------------
    /**
     * @notice Reveal işlemi. Owner çağırır.
     * @param _newBaseURI Pinata'ya yüklenen metadata klasörünün URI'si.
     *                    Örnek: "https://gateway.pinata.cloud/ipfs/QmXxx/"
     *                    tokenURI(1) → _newBaseURI + "1.json"
     */
    function reveal(string calldata _newBaseURI) external onlyOwner {
        require(!revealed, "Already revealed");
        revealed     = true;
        baseTokenURI = _newBaseURI;
        emit Revealed(_newBaseURI);
    }

    /// @notice Revealed olduktan sonra baseURI değiştirilebilir (acil durum için)
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
    }

    /// @notice Unrevealed URI'yi değiştir (yeni görsel olursa)
    function setUnrevealedURI(string calldata _uri) external onlyOwner {
        unrevealedURI = _uri;
    }

    // ---------------------------------------------------------------
    // ADMIN
    // ---------------------------------------------------------------
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

    /// @notice Royalty alıcısı ve oranı (max %10)
    function setRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        require(feeNumerator <= 1000, "Max royalty is 10%");
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function withdrawPangs() external onlyOwner {
        require(address(pangsToken) != address(0), "PANGS token not set");
        pangsToken.transfer(owner(), pangsToken.balanceOf(address(this)));
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

    // ---------------------------------------------------------------
    // TOKEN URI
    // ---------------------------------------------------------------
    function _baseURI() internal view virtual override returns (string memory) {
        return baseTokenURI;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        virtual
        override(ERC721A, IERC721A)
        returns (string memory)
    {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();

        // Reveal öncesi → herkese aynı gizemli görsel
        if (!revealed) {
            return unrevealedURI;
        }

        // Reveal sonrası → her tokenın kendi metadata dosyası
        string memory base = _baseURI();
        return bytes(base).length != 0
            ? string(abi.encodePacked(base, tokenId.toString(), ".json"))
            : "";
    }

    // ---------------------------------------------------------------
    // ERC-165 supportsInterface
    // ---------------------------------------------------------------
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721A, ERC2981, IERC721A)
        returns (bool)
    {
        return
            ERC721A.supportsInterface(interfaceId) ||
            ERC2981.supportsInterface(interfaceId);
    }
}
