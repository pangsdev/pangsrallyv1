// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title PangsRallyBeta
 * @notice Test (Beta) Season pass. Free: the player pays only gas. One per wallet.
 *         Only wallets that joined the test season with an invite code can mint:
 *         the game server signs a voucher for the caller's address, and the
 *         contract checks it. Every token shares the same artwork (constant URI).
 */
contract PangsRallyBeta is ERC721, Ownable {
    using MessageHashUtils for bytes32;

    uint256 public totalMinted;
    /// @notice True once a wallet has minted. The game checks this, so a pass
    ///         that is later transferred still counts for the wallet that minted it.
    mapping(address => bool) public hasMinted;
    /// @notice Address whose signature authorises a mint (the game server's key).
    address public voucherSigner;
    bool public mintOpen = true;
    string private _uri;

    event Minted(address indexed player, uint256 indexed tokenId);

    constructor(address initialOwner, address signer_, string memory uri_)
        ERC721("Pangs Rally Beta", "PRBETA")
        Ownable(initialOwner)
    {
        voucherSigner = signer_;
        _uri = uri_;
    }

    /// @notice Message the server signs: tied to this chain, this contract and one wallet.
    function voucherHash(address player) public view returns (bytes32) {
        return keccak256(abi.encodePacked("PangsRallyBeta", block.chainid, address(this), player));
    }

    /// @notice Free mint (gas only) with the server's voucher for msg.sender.
    function mint(bytes calldata voucher) external {
        require(mintOpen, "Mint is closed");
        require(!hasMinted[msg.sender], "Already minted");
        address signer = ECDSA.recover(voucherHash(msg.sender).toEthSignedMessageHash(), voucher);
        require(signer == voucherSigner, "Invalid voucher");

        hasMinted[msg.sender] = true;
        uint256 id = ++totalMinted;
        _safeMint(msg.sender, id);
        emit Minted(msg.sender, id);
    }

    // ------------------------------------------------------------------ admin

    function setVoucherSigner(address signer_) external onlyOwner {
        voucherSigner = signer_;
    }

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
    }

    function setTokenURI(string calldata uri_) external onlyOwner {
        _uri = uri_;
    }

    // ------------------------------------------------------------------ views

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _uri;
    }
}
