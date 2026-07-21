// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract PangsRallyOfficial is ERC721Enumerable, Ownable {
    using Strings for uint256;

    // Token Settings
    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public totalSupplyMinted = 0;
    string private _baseTokenURI;

    // PANGS Integration & Economy
    IERC20 public pangsToken;
    uint256 public mintPrice;
    address public treasuryWallet;
    bool public mintIsActive = false;

    // Ecosystem & Level Tracking
    // Levels start at 1 inherently (managed in logic), this mapping stores progression
    mapping(uint256 => uint256) private _pangolinLevel;
    
    // Future Racing/Logic contracts authorized to update levels
    mapping(address => bool) public authorizedContracts;

    // Referral System
    mapping(string => address) public codeToAddress;
    mapping(address => string) public addressToCode;
    mapping(address => address) public referrers;
    mapping(address => uint256) public directReferralsCount;
    mapping(address => uint256) public secondaryReferralsCount;
    mapping(address => uint256) public claimableCommissions;
    mapping(address => uint256) public totalCommissionsEarned;

    event LevelUpgraded(uint256 indexed tokenId, uint256 newLevel);
    event Minted(address indexed minter, uint256 indexed tokenId);
    event ReferralRegistered(address indexed user, address indexed referrer);
    event ReferralCodeCreated(address indexed user, string code);
    event CommissionEarned(address indexed referrer, address indexed user, uint256 amount, uint8 level);
    event CommissionClaimed(address indexed referrer, uint256 amount);

    constructor(
        address initialOwner,
        address _pangsTokenAddress,
        address _treasuryWallet
    ) ERC721("Pangs Rally Genesis", "PANGS") Ownable(initialOwner) {
        pangsToken = IERC20(_pangsTokenAddress);
        treasuryWallet = _treasuryWallet;
    }

    // --- MINTING & REFERRAL LOGIC ---
    function registerReferralCode(string calldata code) external {
        require(bytes(code).length > 0 && bytes(code).length <= 20, "Invalid code length");
        require(codeToAddress[code] == address(0), "Code already taken");
        require(bytes(addressToCode[msg.sender]).length == 0, "Address already has a code");

        codeToAddress[code] = msg.sender;
        addressToCode[msg.sender] = code;

        emit ReferralCodeCreated(msg.sender, code);
    }

    function mint(uint256 numberOfTokens, address referrer) external {
        require(mintIsActive, "Minting is not active yet");
        require(totalSupplyMinted + numberOfTokens <= MAX_SUPPLY, "Would exceed max supply");
        require(numberOfTokens > 0, "Must mint at least 1 token");
        require(address(pangsToken) != address(0), "PANGS token not set");
        require(treasuryWallet != address(0), "Treasury wallet not set");

        uint256 totalCost = mintPrice * numberOfTokens;

        // Transfer PANGS directly from user to this contract first to handle splits
        // NOTE: User must approve this contract first!
        require(
            pangsToken.transferFrom(msg.sender, address(this), totalCost),
            "PANGS transfer failed. Check balance and allowance."
        );

        // Process Referrals
        if (referrers[msg.sender] == address(0) && referrer != msg.sender && referrer != address(0)) {
            referrers[msg.sender] = referrer;
            directReferralsCount[referrer]++;
            emit ReferralRegistered(msg.sender, referrer);
            
            address secondary = referrers[referrer];
            if (secondary != address(0)) {
                secondaryReferralsCount[secondary]++;
            }
        }

        uint256 treasuryShare = totalCost;
        address directRef = referrers[msg.sender];
        if (directRef != address(0)) {
            uint256 directReward = (totalCost * 10) / 100; // 10%
            claimableCommissions[directRef] += directReward;
            totalCommissionsEarned[directRef] += directReward;
            treasuryShare -= directReward;
            emit CommissionEarned(directRef, msg.sender, directReward, 1);

            address secondaryRef = referrers[directRef];
            if (secondaryRef != address(0)) {
                uint256 secondaryReward = (totalCost * 5) / 100; // 5%
                claimableCommissions[secondaryRef] += secondaryReward;
                totalCommissionsEarned[secondaryRef] += secondaryReward;
                treasuryShare -= secondaryReward;
                emit CommissionEarned(secondaryRef, msg.sender, secondaryReward, 2);
            }
        }

        // Send remaining to treasury
        if (treasuryShare > 0) {
            require(pangsToken.transfer(treasuryWallet, treasuryShare), "Treasury transfer failed");
        }

        for (uint256 i = 0; i < numberOfTokens; i++) {
            totalSupplyMinted++;
            uint256 newTokenId = totalSupplyMinted;
            
            // Set initial level to 1
            _pangolinLevel[newTokenId] = 1;
            
            _safeMint(msg.sender, newTokenId);
            emit Minted(msg.sender, newTokenId);
        }
    }

    // --- REFERRAL CLAIMING ---
    function claimCommissions() external {
        uint256 amount = claimableCommissions[msg.sender];
        require(amount > 0, "No commissions to claim");
        
        claimableCommissions[msg.sender] = 0;
        require(pangsToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit CommissionClaimed(msg.sender, amount);
    }

    // --- LEVEL SYSTEM ---
    function getLevel(uint256 tokenId) external view returns (uint256) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _pangolinLevel[tokenId];
    }

    function updateLevel(uint256 tokenId, uint256 newLevel) external {
        require(
            msg.sender == owner() || authorizedContracts[msg.sender],
            "Not authorized to update levels"
        );
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        _pangolinLevel[tokenId] = newLevel;
        emit LevelUpgraded(tokenId, newLevel);
    }

    // --- ADMIN CONTROLS ---
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
    }

    function setBaseURI(string memory baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
    }

    function setAuthorizedContract(address _contract, bool _isAuthorized) external onlyOwner {
        authorizedContracts[_contract] = _isAuthorized;
    }

    // --- METADATA & VIEWS ---
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        uint256 tokenCount = balanceOf(owner);
        uint256[] memory tokensId = new uint256[](tokenCount);
        for (uint256 i = 0; i < tokenCount; i++) {
            tokensId[i] = tokenOfOwnerByIndex(owner, i);
        }
        return tokensId;
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "ERC721Metadata: URI query for nonexistent token");
        
        string memory baseURI = _baseURI();
        return bytes(baseURI).length > 0
            ? string(abi.encodePacked(baseURI, tokenId.toString(), ".json"))
            : "";
    }
}
