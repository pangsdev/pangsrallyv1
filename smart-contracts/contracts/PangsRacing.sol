// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPangsRallyOfficial {
    function referrers(address user) external view returns (address);
}

contract PangsRacing is Ownable, ReentrancyGuard {
    uint256 public entryFee = 0.0001 ether;
    uint256 public platformFee = 1000; // 10% goes to platform, 90% to prize pool
    address public backendSigner;
    address public pangsToken; // Set this to the ERC20 token address when launched
    address public pangsRallyContract;
    
    mapping(uint256 => bool) public usedNonces;
    
    event RaceJoined(address indexed player, uint256 indexed roomId, uint256 indexed tokenId);
    event PrizeClaimed(address indexed winner, uint256 amount, uint256 nonce);
    
    constructor() Ownable(msg.sender) {
        backendSigner = msg.sender;
    }
    
    function setBackendSigner(address _signer) external onlyOwner {
        backendSigner = _signer;
    }
    
    function setEntryFee(uint256 _fee) external onlyOwner {
        entryFee = _fee;
    }
    
    function setPangsToken(address _token) external onlyOwner {
        pangsToken = _token;
    }
    
    function setPangsRallyContract(address _contract) external onlyOwner {
        pangsRallyContract = _contract;
    }
    
    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 2000, "Fee too high");
        platformFee = _feeBps;
    }
    
    function joinRace(uint256 _roomId, uint256 _tokenId) external payable {
        if (pangsToken == address(0)) {
            // ETH Mode
            require(msg.value >= entryFee, "Insufficient entry fee");
            // Excess refund
            if (msg.value > entryFee) {
                (bool success, ) = payable(msg.sender).call{value: msg.value - entryFee}("");
                require(success, "Refund failed");
            }
        } else {
            // ERC20 Mode
            require(msg.value == 0, "Do not send ETH, use token");
            bool success = IERC20(pangsToken).transferFrom(msg.sender, address(this), entryFee);
            require(success, "Token transfer failed");
        }
        
        emit RaceJoined(msg.sender, _roomId, _tokenId);
    }
    
    // Securely claim prize using a server-signed message (ECDSA)
    function claimPrize(uint256 _amount, uint256 _nonce, bytes calldata _signature) external nonReentrant {
        require(!usedNonces[_nonce], "Nonce already used");
        
        // Recreate the message hash that the backend signed
        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, _amount, _nonce));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        
        // Verify the signature
        address recoveredSigner = ECDSA.recover(ethSignedMessageHash, _signature);
        require(recoveredSigner == backendSigner, "Invalid signature");
        
        usedNonces[_nonce] = true;
        
        // Calculate platform fee
        uint256 pFee = (_amount * platformFee) / 10000;
        uint256 winnerAmount = _amount - pFee;
        
        uint256 directCut = 0;
        uint256 secondaryCut = 0;
        address directRef = address(0);
        address secondaryRef = address(0);

        if (pangsRallyContract != address(0)) {
            directRef = IPangsRallyOfficial(pangsRallyContract).referrers(msg.sender);
            if (directRef != address(0)) {
                directCut = (_amount * 200) / 10000; // 2% of total prize
                secondaryRef = IPangsRallyOfficial(pangsRallyContract).referrers(directRef);
                if (secondaryRef != address(0)) {
                    secondaryCut = (_amount * 100) / 10000; // 1% of total prize
                }
            }
        }

        // Ensure cuts don't exceed the platform fee
        if (directCut + secondaryCut > pFee) {
            directCut = 0;
            secondaryCut = 0;
        }
        
        if (pangsToken == address(0)) {
            require(address(this).balance >= winnerAmount + directCut + secondaryCut, "Insufficient ETH balance");
            (bool success, ) = payable(msg.sender).call{value: winnerAmount}("");
            require(success, "Prize transfer failed");
            
            if (directCut > 0) {
                payable(directRef).call{value: directCut}("");
            }
            if (secondaryCut > 0) {
                payable(secondaryRef).call{value: secondaryCut}("");
            }
        } else {
            require(IERC20(pangsToken).balanceOf(address(this)) >= winnerAmount + directCut + secondaryCut, "Insufficient Token balance");
            bool success = IERC20(pangsToken).transfer(msg.sender, winnerAmount);
            require(success, "Token prize transfer failed");
            
            if (directCut > 0) {
                IERC20(pangsToken).transfer(directRef, directCut);
            }
            if (secondaryCut > 0) {
                IERC20(pangsToken).transfer(secondaryRef, secondaryCut);
            }
        }
        
        emit PrizeClaimed(msg.sender, winnerAmount, _nonce);
    }
    
    function withdrawFees() external onlyOwner {
        if (pangsToken == address(0)) {
            uint256 balance = address(this).balance;
            (bool success, ) = payable(owner()).call{value: balance}("");
            require(success, "ETH withdraw failed");
        } else {
            uint256 balance = IERC20(pangsToken).balanceOf(address(this));
            bool success = IERC20(pangsToken).transfer(owner(), balance);
            require(success, "Token withdraw failed");
        }
    }
    
    // Receive fallback to accept ETH if needed
    receive() external payable {}
}
