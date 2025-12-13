// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

/**
 * @title Игра «Угадай число» (одно число, заданное заранее)
 * @author Зейбольд Алексей Витальевич Кузьминых Данил Альбертович
 * @notice Децентрализованная игра "Угадай число" на блокчейне с системой подсказок
 *
 * МЕХАНИКА:
 * - Owner может быть сам ведущим или отдать роль игроку
 * - Если игра началась (число установлено), ведущего менять нельзя
 * - Текущий ведущий может сменить число (очистятся попытки и подсказки для участников, но пул остается)
 * - Текущий ведущий не может сменить ведущего (только Owner может)
 * - После окончания игры (угадали или закончился лимит попыток) - роль возвращается Owner
 * - После окончания игры Owner снова может отдать роль ведущего другому игроку
 * - В игре есть возможность взять 3 подсказки
 */

contract GuessTheNumber {

    address public owner;
    address public guessMaster;
    address public permanentGuessMaster; // кто был ведущим при setSecretNumber
    
    uint256 public secretNumber;
    bool public numberIsSet;

    uint256 public minBet = 0.001 ether;
    uint256 public maxBet = 1000 ether;

    uint256 public totalAttempts;
    uint256 public maxAttempts = 10;

    uint256 public usedHints;
    uint256 public maxHintsPerGame = 3;

    address[] public attemptedPlayers;
    mapping(address => uint256) public playerAttempts;
    mapping(address => uint256) public playerHintsUsed;
    mapping(address => uint256) public playerBets;


    // ==================== EVENTS ====================

    event GuessMasterChanged(
        address indexed newGuessMaster,
        address indexed previousGuessMaster
    );

    event NumberSet(
        address indexed guessMaster,
        uint256 indexed secretNumber,
        uint256 timestamp
    );

    event GuessAttempt(
        address indexed player,
        uint256 indexed guess,
        uint256 betAmount,
        bool isCorrect,
        uint256 prizePool,
        uint256 attemptNumber
    );

    event HintUsed(
        address indexed player,
        uint256 indexed guess,
        bool isHigher,
        uint256 hintCost,
        uint256 newPoolAmount,
        uint256 hintsRemaining
    );

    /**
     * @param winner Адрес угадавшего (или address(0) если не угадал)
     * @param prizeAmount Размер выигрыша (для победителя) или пула (для ведущего)
     */
    event GameEnded(
        address indexed winner,
        uint256 indexed prizeAmount,
        address indexed guessMaster,
        uint256 totalAttempts,
        bool isWin
    );

    event AttemptsLimitReached(
        address indexed guessMaster,
        uint256 poolAmount,
        uint256 totalAttempts
    );

    event GameReset(
        address indexed guessMaster,
        uint256 timestamp
    );

    event CommissionWithdrawn(
        address indexed owner,
        uint256 indexed amount
    );

    modifier onlyOwner() {
        require(
            msg.sender == owner,
            "GuessTheNumber: Only owner can call this function"
        );
        _;
    }

    modifier onlyGuessMaster() {
        require(
            msg.sender == guessMaster,
            "GuessTheNumber: Only guessMaster can call this function"
        );
        _;
    }

    modifier numberMustBeSet() {
        require(
            numberIsSet == true,
            "GuessTheNumber: Number is not set yet"
        );
        _;
    }

    modifier validAddress(address _addr) {
        require(
            _addr != address(0),
            "GuessTheNumber: Invalid address"
        );
        _;
    }

    modifier notGuessMaster() {
        require(
            msg.sender != guessMaster,
            "GuessTheNumber: GuessMaster cannot play"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
        guessMaster = msg.sender;
        permanentGuessMaster = msg.sender;
        numberIsSet = false;
        totalAttempts = 0;
        usedHints = 0;
    }

    /**
     * @notice Owner может назначить нового ведущего только если игра не началась
     * @param _newGuessMaster Адрес нового ведущего
     */
    function setGuessMaster(address _newGuessMaster)
        external
        onlyOwner
        validAddress(_newGuessMaster)
    {
        require(
            !numberIsSet,
            "GuessTheNumber: Cannot change GuessMaster while game is in progress"
        );
        require(
            _newGuessMaster != guessMaster,
            "GuessTheNumber: New guessMaster must be different from current"
        );

        address previousGuessMaster = guessMaster;
        guessMaster = _newGuessMaster;
        permanentGuessMaster = _newGuessMaster;

        emit GuessMasterChanged(_newGuessMaster, previousGuessMaster);
    }

    function setMinBet(uint256 _newMinBet) external onlyOwner {
        require(_newMinBet > 0, "GuessTheNumber: Min bet must be > 0");
        require(_newMinBet <= maxBet, "GuessTheNumber: Min bet cannot exceed max bet");
        minBet = _newMinBet;
    }

    function setMaxBet(uint256 _newMaxBet) external onlyOwner {
        require(_newMaxBet > 0, "GuessTheNumber: Max bet must be > 0");
        require(_newMaxBet >= minBet, "GuessTheNumber: Max bet cannot be < min bet");
        maxBet = _newMaxBet;
    }

    function setMaxAttempts(uint256 _newMaxAttempts) external onlyOwner {
        require(
            _newMaxAttempts > 0 && _newMaxAttempts <= 100,
            "GuessTheNumber: Max attempts must be between 1 and 100"
        );
        maxAttempts = _newMaxAttempts;
    }

    function setMaxHintsPerGame(uint256 _newMaxHints) external onlyOwner {
        require(
            _newMaxHints > 0 && _newMaxHints <= 10,
            "GuessTheNumber: Max hints must be between 1 and 10"
        );
        maxHintsPerGame = _newMaxHints;
    }

    function withdrawOwnerCommission(uint256 _amount) external onlyOwner {
        require(_amount > 0, "GuessTheNumber: Amount must be > 0");
        require(address(this).balance >= _amount, "GuessTheNumber: Insufficient balance");

        (bool success, ) = payable(owner).call{value: _amount}("");
        require(success, "GuessTheNumber: Withdrawal failed");

        emit CommissionWithdrawn(owner, _amount);
    }

    /**
     * @notice Ведущий устанавливает число для угадывания
     * @dev Если число уже было установлено, то очищаем только попытки/подсказки, пул остается!
     */
    function setSecretNumber(uint256 _number)
        external
        onlyGuessMaster
    {
        require(
            _number > 0 && _number <= 100,
            "GuessTheNumber: Number must be between 1 and 100"
        );

        // Сохраняем пул перед потенциальным сбросом
        uint256 savedPool = address(this).balance;

        // Если это первая установка - просто установить
        // Если это переустановка - сбросить попытки/подсказки
        if (numberIsSet && totalAttempts > 0) {
            _resetGameKeepPool();
        }

        secretNumber = _number;
        numberIsSet = true;

        emit NumberSet(msg.sender, _number, block.timestamp);
    }

    function makeGuess(uint256 _guess)
        external
        payable
        numberMustBeSet
        notGuessMaster
    {
        require(
            msg.value >= minBet && msg.value <= maxBet,
            "GuessTheNumber: Bet amount must be between minBet and maxBet"
        );
        require(
            _guess > 0 && _guess <= 100,
            "GuessTheNumber: Guess must be between 1 and 100"
        );
        require(
            totalAttempts < maxAttempts,
            "GuessTheNumber: Maximum attempts reached"
        );

        uint256 prizePoolBeforeBet = address(this).balance - msg.value;

        totalAttempts += 1;
        playerAttempts[msg.sender] += 1;
        playerBets[msg.sender] = msg.value;

        if (playerAttempts[msg.sender] == 1) {
            attemptedPlayers.push(msg.sender);
        }

        bool isCorrect = (_guess == secretNumber);

        emit GuessAttempt(
            msg.sender,
            _guess,
            msg.value,
            isCorrect,
            prizePoolBeforeBet + msg.value,
            totalAttempts
        );

        if (isCorrect) {
            // ПОБЕДА! Отправляем приз, возвращаем роль Owner
            uint256 totalPrize = address(this).balance;

            (bool success, ) = payable(msg.sender).call{value: totalPrize}("");
            require(success, "GuessTheNumber: Prize transfer failed");

            emit GameEnded(msg.sender, totalPrize, guessMaster, totalAttempts, true);

            // Возвращаем роль ведущего Owner
            guessMaster = owner;
            _resetGame();
        } else if (totalAttempts >= maxAttempts) {
            // ЛИМИТ ПОПЫТОК ИСЧЕРПАН! Пул идет ведущему, роль возвращается Owner
            uint256 totalPrize = address(this).balance;

            (bool success, ) = payable(permanentGuessMaster).call{value: totalPrize}("");
            require(success, "GuessTheNumber: Pool transfer failed");

            emit AttemptsLimitReached(permanentGuessMaster, totalPrize, totalAttempts);

            // Возвращаем роль ведущего Owner
            guessMaster = owner;
            _resetGame();
        }
    }

    /**
     * @notice Игрок использует подсказку (платная, удваивает пул)
     * @dev Стоимость = текущий пул (poolBefore)
     * @dev Если введено правильное число - показать окно победы
     */
    function useHint(uint256 _guess)
        external
        payable
        numberMustBeSet
        notGuessMaster
    {
        require(
            _guess > 0 && _guess <= 100,
            "GuessTheNumber: Guess must be between 1 and 100"
        );
        require(
            usedHints < maxHintsPerGame,
            "GuessTheNumber: No more hints available"
        );
        require(
            totalAttempts < maxAttempts,
            "GuessTheNumber: Maximum attempts reached"
        );

        // Пул ДО оплаты
        uint256 poolBefore = address(this).balance - msg.value;

        require(
            poolBefore > 0,
            "GuessTheNumber: Cannot use hint when pool is empty"
        );

        uint256 hintCost = poolBefore;

        require(
            msg.value == hintCost,
            "GuessTheNumber: Hint must be paid exactly with current pool amount"
        );

        totalAttempts += 1;
        usedHints += 1;
        playerAttempts[msg.sender] += 1;
        playerHintsUsed[msg.sender] += 1;

        if (playerAttempts[msg.sender] == 1) {
            attemptedPlayers.push(msg.sender);
        }

        // Проверяем, угадали ли правильное число
        bool isCorrect = (_guess == secretNumber);

        if (isCorrect) {
            // Если угадали - эмитим GuessAttempt как обычную ставку
            emit GuessAttempt(
                msg.sender,
                _guess,
                0, // bet amount = 0 для подсказки
                true,
                address(this).balance,
                totalAttempts
            );

            // Отправляем приз
            uint256 totalPrize = address(this).balance;
            (bool success, ) = payable(msg.sender).call{value: totalPrize}("");
            require(success, "GuessTheNumber: Prize transfer failed");

            emit GameEnded(msg.sender, totalPrize, guessMaster, totalAttempts, true);

            // Возвращаем роль ведущего Owner
            guessMaster = owner;
            _resetGame();
        } else {
            // Если не угадали - показываем подсказку как обычно
            bool isHigher = (_guess < secretNumber);

            uint256 newPoolAmount = address(this).balance;
            uint256 hintsRemaining = maxHintsPerGame - usedHints;

            emit HintUsed(msg.sender, _guess, isHigher, hintCost, newPoolAmount, hintsRemaining);

            if (totalAttempts >= maxAttempts) {
                uint256 totalPrize = address(this).balance;

                (bool success, ) = payable(permanentGuessMaster).call{value: totalPrize}("");
                require(success, "GuessTheNumber: Pool transfer failed");

                emit AttemptsLimitReached(permanentGuessMaster, totalPrize, totalAttempts);

                guessMaster = owner;
                _resetGame();
            }
        }
    }

    function getPrizePool() external view returns (uint256) {
        return address(this).balance;
    }

    function getHintCost() external view returns (uint256) {
        return address(this).balance;
    }

    function getPlayerAttempts(address _player) external view returns (uint256) {
        return playerAttempts[_player];
    }

    function getPlayerHintsUsed(address _player) external view returns (uint256) {
        return playerHintsUsed[_player];
    }

    function getPlayerBet(address _player) external view returns (uint256) {
        return playerBets[_player];
    }

    function getTotalPlayers() external view returns (uint256) {
        return attemptedPlayers.length;
    }

    function getPlayerAtIndex(uint256 _index) external view returns (address) {
        require(_index < attemptedPlayers.length, "GuessTheNumber: Index out of bounds");
        return attemptedPlayers[_index];
    }

    function getGameStatus()
        external
        view
        returns (
            address _owner,
            address _guessMaster,
            bool _numberIsSet,
            uint256 _totalAttempts,
            uint256 _prizePool
        )
    {
        return (
            owner,
            guessMaster,
            numberIsSet,
            totalAttempts,
            address(this).balance
        );
    }

    /**
     * @notice Расширенный статус: теперь включает maxHintsPerGame и maxAttempts
     */
    function getGameStatusExtended()
        external
        view
        returns (
            address _owner,
            address _guessMaster,
            bool _numberIsSet,
            uint256 _totalAttempts,
            uint256 _maxAttempts,
            uint256 _prizePool,
            uint256 _remainingAttempts,
            uint256 _usedHints,
            uint256 _remainingHints,
            uint256 _hintCost,
            uint256 _maxHintsPerGame
        )
    {
        uint256 pool = address(this).balance;
        return (
            owner,
            guessMaster,
            numberIsSet,
            totalAttempts,
            maxAttempts,
            pool,
            maxAttempts > totalAttempts ? maxAttempts - totalAttempts : 0,
            usedHints,
            maxHintsPerGame > usedHints ? maxHintsPerGame - usedHints : 0,
            pool,
            maxHintsPerGame
        );
    }

    function ethToWei(uint256 _ethAmount) external pure returns (uint256) {
        return _ethAmount * 1 ether;
    }

    function weiToEth(uint256 _weiAmount) external pure returns (uint256) {
        return _weiAmount / 1 ether;
    }

    /**
     * @notice Сброс игры (очищаем попытки/подсказки, число и роль)
     */
    function _resetGame() internal {
        for (uint256 i = 0; i < attemptedPlayers.length; i++) {
            address player = attemptedPlayers[i];
            playerAttempts[player] = 0;
            playerHintsUsed[player] = 0;
            playerBets[player] = 0;
        }

        delete attemptedPlayers;

        numberIsSet = false;
        totalAttempts = 0;
        usedHints = 0;
        secretNumber = 0;

        emit GameReset(guessMaster, block.timestamp);
    }

    /**
     * @notice Сброс игры БЕЗ очистки пула (для переустановки числа текущим ведущим)
     */
    function _resetGameKeepPool() internal {
        for (uint256 i = 0; i < attemptedPlayers.length; i++) {
            address player = attemptedPlayers[i];
            playerAttempts[player] = 0;
            playerHintsUsed[player] = 0;
            playerBets[player] = 0;
        }

        delete attemptedPlayers;

        numberIsSet = false;
        totalAttempts = 0;
        usedHints = 0;
        secretNumber = 0;

        emit GameReset(guessMaster, block.timestamp);
    }

    receive() external payable {}
}