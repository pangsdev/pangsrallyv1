// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";

/**
 * @title PangsRallyBetaPass
 * @notice Soulbound-style Beta Pass NFT. 1 per wallet. ERC-2981 %5 royalty.
 *         Herkese aynı görsel gelir (constant token URI). Reveal yok.
 */
contract PangsRallyBetaPass is ERC721Enumerable, Ownable, ERC2981 {
    uint256 public totalSupplyMinted = 0;
    string private _constantTokenURI;

    // PANGS Integration
    IERC20 public pangsToken;
    uint256 public mintPrice = 1000 * 10**18; // 1000 PANGS default
    address public treasuryWallet;
    bool public mintIsActive = true;

    event Minted(address indexed minter, uint256 indexed tokenId);

    constructor(
        address initialOwner,
        address _pangsTokenAddress,
        address _treasuryWallet,
        string memory _tokenURI
    ) ERC721("Pangs Rally Beta Pass", "PRBETA") Ownable(initialOwner) {
        pangsToken    = IERC20(_pangsTokenAddress);
        treasuryWallet = _treasuryWallet;
        _constantTokenURI = _tokenURI;

        // %5 royalty (500 basis points) -> treasury wallet
        _setDefaultRoyalty(_treasuryWallet, 500);
    }

    // ---------------------------------------------------------------
    // MINT
    // ---------------------------------------------------------------
    function mint(uint256 numberOfTokens) external {
        require(mintIsActive,                       "Minting is not active");
        require(numberOfTokens == 1,                "Only 1 Beta Pass per wallet");
        require(balanceOf(msg.sender) == 0,         "You already own a Beta Pass");

        uint256 totalCost = mintPrice * numberOfTokens;

        if (totalCost > 0) {
            require(address(pangsToken) != address(0), "PANGS token not set");
            require(treasuryWallet      != address(0), "Treasury wallet not set");
            require(
                pangsToken.transferFrom(msg.sender, treasuryWallet, totalCost),
                "PANGS transfer failed. Check balance and allowance."
            );
        }

        totalSupplyMinted++;
        uint256 newTokenId = totalSupplyMinted;

        _safeMint(msg.sender, newTokenId);
        emit Minted(msg.sender, newTokenId);
    }

    // ---------------------------------------------------------------
    // AIRDROP
    // ---------------------------------------------------------------
    /**
     * @notice Allows owner to airdrop Beta Passes to a list of addresses.
     *         Bypasses PANGS cost and active check. Enforces 1 per wallet.
     * @param recipients Array of addresses to receive the Beta Pass.
     */
    function airdrop(address[] calldata recipients) external onlyOwner {
        for (uint256 i = 0; i < recipients.length; i++) {
            address to = recipients[i];
            
            // Skip if the recipient already has a Beta Pass (enforce 1 per wallet)
            if (balanceOf(to) > 0) {
                continue;
            }

            totalSupplyMinted++;
            uint256 newTokenId = totalSupplyMinted;
            
            _safeMint(to, newTokenId);
            emit Minted(to, newTokenId);
        }
    }

    // ---------------------------------------------------------------
    // ADMIN
    // ---------------------------------------------------------------
    function setMintActive(bool _isActive) external onlyOwner {
        mintIsActive = _isActive;
    }

    function setMintPrice(uint256 _newPrice) external onlyOwner {
        mintPrice = _newPrice;
    }

    function setPangsToken(address _newTokenAddress) external onlyOwner {
        pangsToken = IERC20(_newTokenAddress);
    }

    function setTreasuryWallet(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Cannot be zero address");
        treasuryWallet = _newTreasury;
        // Royalty adresini de güncelle
        _setDefaultRoyalty(_newTreasury, 500);
    }

    function setTokenURI(string memory _tokenURI) external onlyOwner {
        _constantTokenURI = _tokenURI;
    }

    /// @notice Royalty alıcısını veya oranını değiştir (max %10 = 1000)
    function setRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        require(feeNumerator <= 1000, "Max royalty is 10%");
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    // ---------------------------------------------------------------
    // VIEWS
    // ---------------------------------------------------------------
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        uint256 tokenCount = balanceOf(owner);
        uint256[] memory tokensId = new uint256[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            tokensId[i] = tokenOfOwnerByIndex(owner, i);
        }
        return tokensId;
    }

    function tokenURI(uint256 /*tokenId*/) public view virtual override returns (string memory) {
        return _constantTokenURI;
    }

    // ---------------------------------------------------------------
    // ERC-165 supportsInterface — ERC2981 + ERC721Enumerable
    // ---------------------------------------------------------------
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721Enumerable, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
