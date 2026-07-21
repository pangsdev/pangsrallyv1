// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PangsMarketplace is Ownable, ReentrancyGuard {
    IERC721 public pangsNft;
    
    uint256 public platformFee = 500; // 5% (out of 10000 basis points)
    
    struct Listing {
        uint256 tokenId;
        address seller;
        uint256 price;
        bool active;
    }
    
    mapping(uint256 => Listing) public listings; // tokenId => Listing
    uint256[] public activeListingIds;
    mapping(uint256 => uint256) private activeListingIndex;
    
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Sale(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event Canceled(uint256 indexed tokenId, address indexed seller);
    
    constructor(address _nftAddress) Ownable(msg.sender) {
        pangsNft = IERC721(_nftAddress);
    }
    
    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 2000, "Fee too high"); // max 20%
        platformFee = _feeBps;
    }
    
    function listPangolin(uint256 _tokenId, uint256 _price) external {
        require(pangsNft.ownerOf(_tokenId) == msg.sender, "Not the owner");
        require(pangsNft.getApproved(_tokenId) == address(this) || pangsNft.isApprovedForAll(msg.sender, address(this)), "Marketplace not approved");
        require(_price > 0, "Price must be greater than 0");
        
        if (!listings[_tokenId].active) {
            activeListingIndex[_tokenId] = activeListingIds.length;
            activeListingIds.push(_tokenId);
        }
        
        listings[_tokenId] = Listing({
            tokenId: _tokenId,
            seller: msg.sender,
            price: _price,
            active: true
        });
        
        emit Listed(_tokenId, msg.sender, _price);
    }
    
    function buyPangolin(uint256 _tokenId) external payable nonReentrant {
        Listing memory listing = listings[_tokenId];
        require(listing.active, "Not listed");
        require(msg.value >= listing.price, "Insufficient funds sent");
        
        // Remove listing
        _removeListing(_tokenId);
        
        // Calculate fees
        uint256 feeAmount = (listing.price * platformFee) / 10000;
        uint256 sellerAmount = listing.price - feeAmount;
        
        // Transfer NFT
        pangsNft.transferFrom(listing.seller, msg.sender, _tokenId);
        
        // Pay seller
        (bool success, ) = payable(listing.seller).call{value: sellerAmount}("");
        require(success, "Transfer to seller failed");
        
        // Refund excess
        if (msg.value > listing.price) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - listing.price}("");
            require(refundSuccess, "Refund failed");
        }
        
        emit Sale(_tokenId, listing.seller, msg.sender, listing.price);
    }
    
    function cancelListing(uint256 _tokenId) external {
        Listing memory listing = listings[_tokenId];
        require(listing.active, "Not listed");
        require(listing.seller == msg.sender || msg.sender == owner(), "Not the seller");
        
        _removeListing(_tokenId);
        emit Canceled(_tokenId, msg.sender);
    }
    
    function _removeListing(uint256 _tokenId) internal {
        listings[_tokenId].active = false;
        
        uint256 index = activeListingIndex[_tokenId];
        uint256 lastTokenId = activeListingIds[activeListingIds.length - 1];
        
        activeListingIds[index] = lastTokenId;
        activeListingIndex[lastTokenId] = index;
        
        activeListingIds.pop();
        delete activeListingIndex[_tokenId];
    }
    
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdraw failed");
    }
    
    function getActiveListings() external view returns (Listing[] memory) {
        Listing[] memory active = new Listing[](activeListingIds.length);
        for(uint256 i = 0; i < activeListingIds.length; i++) {
            active[i] = listings[activeListingIds[i]];
        }
        return active;
    }
}
