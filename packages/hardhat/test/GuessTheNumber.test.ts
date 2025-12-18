import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("GuessTheNumber - Extended Tests", function () {
  async function deployFixture() {
    const [owner, player1, player2, player3] = await ethers.getSigners();
    const GuessTheNumber = await ethers.getContractFactory("GuessTheNumber");
    const contract = await GuessTheNumber.deploy();
    await contract.waitForDeployment();
    return { contract, owner, player1, player2, player3 };
  }

  describe("Deployment", function () {
    it("Должен установить owner и guessMaster как deployer", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.guessMaster()).to.equal(owner.address);
      expect(await contract.numberIsSet()).to.be.false;
      expect(await contract.totalAttempts()).to.equal(0);
      expect(await contract.usedHints()).to.equal(0);
    });

    it("Должны быть корректные начальные значения bet и attempts", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.minBet()).to.equal(ethers.parseEther("0.001"));
      expect(await contract.maxBet()).to.equal(ethers.parseEther("1000"));
      expect(await contract.maxAttempts()).to.equal(10);
      expect(await contract.maxHintsPerGame()).to.equal(3);
    });
  });

  describe("setGuessMaster - Extended", function () {
    it("Нельзя выбрать одного и того же ведущего", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await expect(contract.connect(owner).setGuessMaster(owner.address))
        .to.be.revertedWith("GuessTheNumber: New guessMaster must be different from current");
    });

    it("Нельзя назначить нулевой адрес", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await expect(contract.connect(owner).setGuessMaster(ethers.ZeroAddress))
        .to.be.revertedWith("GuessTheNumber: Invalid address");
    });

    it("Можно сменить ведущего несколько раз подряд", async function () {
      const { contract, owner, player1, player2 } = await loadFixture(deployFixture);
      await contract.connect(owner).setGuessMaster(player1.address);
      expect(await contract.guessMaster()).to.equal(player1.address);
      
      await contract.connect(owner).setGuessMaster(player2.address);
      expect(await contract.guessMaster()).to.equal(player2.address);
    });

    it("permanentGuessMaster обновляется при смене ведущего", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      expect(await contract.permanentGuessMaster()).to.equal(owner.address);
      
      await contract.connect(owner).setGuessMaster(player1.address);
      expect(await contract.permanentGuessMaster()).to.equal(player1.address);
    });
  });

  describe("setSecretNumber - Extended", function () {
    it("Число 1 и 100 - граничные значения (валидны)", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await contract.connect(owner).setSecretNumber(1);
      expect(await contract.secretNumber()).to.equal(1);
      
      await contract.connect(owner).setSecretNumber(100);
      expect(await contract.secretNumber()).to.equal(100);
    });

    it("Только guessMaster может установить число", async function () {
      const { contract, player1 } = await loadFixture(deployFixture);
      await expect(contract.connect(player1).setSecretNumber(42))
        .to.be.revertedWith("GuessTheNumber: Only guessMaster can call this function");
    });

    it("Переустановка числа сбрасывает только попытки, не пул", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      const initialFund = ethers.parseEther("0.5");
      await owner.sendTransaction({ to: await contract.getAddress(), value: initialFund });
      
      await contract.connect(owner).setSecretNumber(42);
      const pool1 = await contract.getPrizePool();
      
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      expect(await contract.totalAttempts()).to.equal(1);
      
      await contract.connect(owner).setSecretNumber(50);
      expect(await contract.totalAttempts()).to.equal(0);
      expect(await contract.usedHints()).to.equal(0);
      const pool2 = await contract.getPrizePool();
      expect(pool2).to.be.gte(pool1);
    });

    it("playerAttempts очищаются при переустановке", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      expect(await contract.getPlayerAttempts(player1.address)).to.equal(1);
      
      await contract.connect(owner).setSecretNumber(50);
      expect(await contract.getPlayerAttempts(player1.address)).to.equal(0);
    });
  });

  describe("makeGuess - Extended", function () {
    it("Неправильный guess увеличивает попытки", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      expect(await contract.totalAttempts()).to.equal(0);
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      expect(await contract.totalAttempts()).to.equal(1);
      
      await contract.connect(player1).makeGuess(50, { value: ethers.parseEther("0.001") });
      expect(await contract.totalAttempts()).to.equal(2);
    });

    it("Один игрок может делать несколько попыток", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      await contract.connect(player1).makeGuess(20, { value: ethers.parseEther("0.001") });
      await contract.connect(player1).makeGuess(30, { value: ethers.parseEther("0.001") });
      
      expect(await contract.getPlayerAttempts(player1.address)).to.equal(3);
      expect(await contract.totalAttempts()).to.equal(3);
    });

    it("GuessMaster не может делать guess", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await expect(contract.connect(owner).makeGuess(42, { value: ethers.parseEther("0.001") }))
        .to.be.revertedWith("GuessTheNumber: GuessMaster cannot play");
    });

    it("Guess вне диапазона (1-100)", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await expect(contract.connect(player1).makeGuess(0, { value: ethers.parseEther("0.001") }))
        .to.be.revertedWith("GuessTheNumber: Guess must be between 1 and 100");
      
      await expect(contract.connect(player1).makeGuess(101, { value: ethers.parseEther("0.001") }))
        .to.be.revertedWith("GuessTheNumber: Guess must be between 1 and 100");
    });

    it("Несколько игроков могут играть одновременно", async function () {
      const { contract, owner, player1, player2, player3 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      await contract.connect(player2).makeGuess(20, { value: ethers.parseEther("0.001") });
      await contract.connect(player3).makeGuess(30, { value: ethers.parseEther("0.001") });
      
      expect(await contract.getTotalPlayers()).to.equal(3);
      expect(await contract.getPlayerAttempts(player1.address)).to.equal(1);
      expect(await contract.getPlayerAttempts(player2.address)).to.equal(1);
      expect(await contract.getPlayerAttempts(player3.address)).to.equal(1);
    });

    it("attemptedPlayers список обновляется корректно", async function () {
      const { contract, owner, player1, player2 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      await contract.connect(player1).makeGuess(20, { value: ethers.parseEther("0.001") });
      await contract.connect(player2).makeGuess(30, { value: ethers.parseEther("0.001") });
      
      expect(await contract.getTotalPlayers()).to.equal(2);
      expect(await contract.getPlayerAtIndex(0)).to.equal(player1.address);
      expect(await contract.getPlayerAtIndex(1)).to.equal(player2.address);
    });

    it("После угадывания пул переходит игроку", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      const fundAmount = ethers.parseEther("1");
      await owner.sendTransaction({ to: await contract.getAddress(), value: fundAmount });
      await contract.connect(owner).setSecretNumber(42);
      
      const playerBalBefore = await ethers.provider.getBalance(player1.address);
      const poolBefore = await contract.getPrizePool();
      
      await contract.connect(player1).makeGuess(42, { value: ethers.parseEther("0.001") });
      
      const playerBalAfter = await ethers.provider.getBalance(player1.address);
      expect(playerBalAfter).to.be.gt(playerBalBefore);
    });

    it("После достижения лимита попыток пул идет ведущему", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setMaxAttempts(2);
      await contract.connect(owner).setSecretNumber(42);
      
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      const poolBeforeLimit = await contract.getPrizePool();
      
      await contract.connect(player1).makeGuess(20, { value: ethers.parseEther("0.001") });
      
      expect(await contract.numberIsSet()).to.be.false; // игра завершена
      expect(await contract.guessMaster()).to.equal(owner.address); // роль вернулась
    });

    it("Нельзя делать guess если число не установлено", async function () {
      const { contract, player1 } = await loadFixture(deployFixture);
      await expect(contract.connect(player1).makeGuess(42, { value: ethers.parseEther("0.001") }))
        .to.be.revertedWith("GuessTheNumber: Number is not set yet");
    });
  });

  describe("useHint - Extended", function () {
    it("Подсказка стоит равно текущему пулу", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      const poolBefore = await contract.getPrizePool();
      const hintCost = await contract.getHintCost();
      expect(hintCost).to.equal(poolBefore);
      
      await contract.connect(player1).useHint(30, { value: hintCost });
    });

    it("Подсказка при неправильном guess показывает направление (выше/ниже)", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      const tx = await contract.connect(player1).useHint(30, { value: await contract.getHintCost() });
      const receipt = await tx.wait();
      
      const events = receipt?.logs.map(log => {
        try {
          return contract.interface.parseLog(log);
        } catch (e) {
          return null;
        }
      }).filter(e => e?.name === "HintUsed");
      
      expect(events?.[0]?.args?.[2]).to.equal(true); // isHigher = true (30 < 42)
    });

    it("Максимум 3 подсказки за игру", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("1") });
      await contract.connect(owner).setSecretNumber(42);
      
      let hintCost = await contract.getHintCost();
      await contract.connect(player1).useHint(10, { value: hintCost });
      
      hintCost = await contract.getHintCost();
      await contract.connect(player1).useHint(20, { value: hintCost });
      
      hintCost = await contract.getHintCost();
      await contract.connect(player1).useHint(30, { value: hintCost });
      
      expect(await contract.usedHints()).to.equal(3);
      hintCost = await contract.getHintCost();
      await expect(contract.connect(player1).useHint(35, { value: hintCost }))
        .to.be.revertedWith("GuessTheNumber: No more hints available");
    });

    it("GuessMaster не может использовать подсказку", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      const hintCost = await contract.getHintCost();
      await expect(contract.connect(owner).useHint(30, { value: hintCost }))
        .to.be.revertedWith("GuessTheNumber: GuessMaster cannot play");
    });

    it("Подсказка правильного числа ведет к победе", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      const hintCost = await contract.getHintCost();
      const tx = await contract.connect(player1).useHint(42, { value: hintCost });
      
      const receipt = await tx.wait();
      const events = receipt?.logs.map(log => {
        try {
          return contract.interface.parseLog(log);
        } catch (e) {
          return null;
        }
      }).filter(e => e?.name === "GameEnded");
      
      expect(events?.length).to.equal(1);
      expect(events?.[0]?.args?.[0]).to.equal(player1.address);
    });

    it("Нельзя использовать подсказку при пустом пуле", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await contract.connect(owner).setSecretNumber(42);
      
      await expect(contract.connect(player1).useHint(30, { value: ethers.parseEther("0.001") }))
        .to.be.revertedWith("GuessTheNumber: Cannot use hint when pool is empty");
    });

    it("playerHintsUsed отслеживает подсказки игрока", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.5") });
      await contract.connect(owner).setSecretNumber(42);
      
      let hintCost = await contract.getHintCost();
      await contract.connect(player1).useHint(10, { value: hintCost });
      expect(await contract.getPlayerHintsUsed(player1.address)).to.equal(1);
      
      hintCost = await contract.getHintCost();
      await contract.connect(player1).useHint(20, { value: hintCost });
      expect(await contract.getPlayerHintsUsed(player1.address)).to.equal(2);
    });
  });

  describe("Owner Settings", function () {
    it("setMinBet - корректное изменение", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const newMinBet = ethers.parseEther("0.01");
      await contract.connect(owner).setMinBet(newMinBet);
      expect(await contract.minBet()).to.equal(newMinBet);
    });

    it("setMinBet - revert если 0", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await expect(contract.connect(owner).setMinBet(0))
        .to.be.revertedWith("GuessTheNumber: Min bet must be > 0");
    });

    it("setMinBet - revert если больше maxBet", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const maxBet = await contract.maxBet();
      const newValue = maxBet + ethers.parseEther("1");
      await expect(contract.connect(owner).setMinBet(newValue))
        .to.be.revertedWith("GuessTheNumber: Min bet cannot exceed max bet");
    });

    it("setMaxBet - корректное изменение", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const newMaxBet = ethers.parseEther("2000");
      await contract.connect(owner).setMaxBet(newMaxBet);
      expect(await contract.maxBet()).to.equal(newMaxBet);
    });

    it("setMaxBet - revert если меньше minBet", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const minBet = await contract.minBet();
      const newValue = minBet - ethers.parseEther("0.0001");
      await expect(contract.connect(owner).setMaxBet(newValue))
        .to.be.revertedWith("GuessTheNumber: Max bet cannot be < min bet");
    });

    it("setMaxAttempts - корректное изменение (1-100)", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await contract.connect(owner).setMaxAttempts(50);
      expect(await contract.maxAttempts()).to.equal(50);
    });

    it("setMaxAttempts - revert вне диапазона", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await expect(contract.connect(owner).setMaxAttempts(0))
        .to.be.revertedWith("GuessTheNumber: Max attempts must be between 1 and 100");
      await expect(contract.connect(owner).setMaxAttempts(101))
        .to.be.revertedWith("GuessTheNumber: Max attempts must be between 1 and 100");
    });

    it("setMaxHintsPerGame - корректное изменение (1-10)", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await contract.connect(owner).setMaxHintsPerGame(5);
      expect(await contract.maxHintsPerGame()).to.equal(5);
    });

    it("setMaxHintsPerGame - revert вне диапазона", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await expect(contract.connect(owner).setMaxHintsPerGame(0))
        .to.be.revertedWith("GuessTheNumber: Max hints must be between 1 and 10");
      await expect(contract.connect(owner).setMaxHintsPerGame(11))
        .to.be.revertedWith("GuessTheNumber: Max hints must be between 1 and 10");
    });

    it("Только owner может менять настройки", async function () {
      const { contract, player1 } = await loadFixture(deployFixture);
      await expect(contract.connect(player1).setMinBet(ethers.parseEther("0.01")))
        .to.be.revertedWith("GuessTheNumber: Only owner can call this function");
      
      await expect(contract.connect(player1).setMaxBet(ethers.parseEther("2000")))
        .to.be.revertedWith("GuessTheNumber: Only owner can call this function");
      
      await expect(contract.connect(player1).setMaxAttempts(20))
        .to.be.revertedWith("GuessTheNumber: Only owner can call this function");
    });
  });

  describe("View Functions", function () {
    it("getGameStatus возвращает текущее состояние", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      const status = await contract.getGameStatus();
      expect(status._owner).to.equal(owner.address);
      expect(status._guessMaster).to.equal(owner.address);
      expect(status._numberIsSet).to.be.true;
      expect(status._totalAttempts).to.equal(0);
      expect(status._prizePool).to.be.gt(0);
    });

    it("getGameStatusExtended содержит дополнительную информацию", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      
      const status = await contract.getGameStatusExtended();
      expect(status._maxAttempts).to.equal(10);
      expect(status._totalAttempts).to.equal(1);
      expect(status._remainingAttempts).to.equal(9);
      expect(status._usedHints).to.equal(0);
      expect(status._remainingHints).to.equal(3);
    });

    it("getPrizePool возвращает текущий баланс контракта", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("0.5");
      await owner.sendTransaction({ to: await contract.getAddress(), value: amount });
      
      expect(await contract.getPrizePool()).to.equal(amount);
    });

    it("getHintCost равно текущему пулу", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("0.5");
      await owner.sendTransaction({ to: await contract.getAddress(), value: amount });
      
      const pool = await contract.getPrizePool();
      const hintCost = await contract.getHintCost();
      expect(hintCost).to.equal(pool);
    });
  });

  describe("Utility Functions", function () {
    it("ethToWei конвертирует ether в wei", async function () {
      const { contract } = await loadFixture(deployFixture);
      const result = await contract.ethToWei(1);
      expect(result).to.equal(ethers.parseEther("1"));
    });

    it("weiToEth конвертирует wei в ether", async function () {
      const { contract } = await loadFixture(deployFixture);
      const wei = ethers.parseEther("5");
      const result = await contract.weiToEth(wei);
      expect(result).to.equal(5);
    });
  });

  describe("Edge Cases & Security", function () {
    it("Нельзя угадать число дважды (второй раз игра уже сброшена)", async function () {
      const { contract, owner, player1, player2 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await contract.connect(player1).makeGuess(42, { value: ethers.parseEther("0.001") });
      
      // Теперь число не установлено
      expect(await contract.numberIsSet()).to.be.false;
      
      // Попытка другого игрока не пройдет
      await expect(contract.connect(player2).makeGuess(42, { value: ethers.parseEther("0.001") }))
        .to.be.revertedWith("GuessTheNumber: Number is not set yet");
    });

    it("receive() функция принимает ether", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("1");
      
      const tx = await owner.sendTransaction({
        to: await contract.getAddress(),
        value: amount
      });
      
      expect(await contract.getPrizePool()).to.equal(amount);
    });

    it("Пул растет с каждой неправильной ставкой", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      const pool1 = await contract.getPrizePool();
      await contract.connect(player1).makeGuess(10, { value: ethers.parseEther("0.001") });
      const pool2 = await contract.getPrizePool();
      
      expect(pool2).to.equal(pool1 + ethers.parseEther("0.001"));
    });

    it("После выигрыша все данные игрока очищаются", async function () {
      const { contract, owner, player1 } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("0.1") });
      await contract.connect(owner).setSecretNumber(42);
      
      await contract.connect(player1).makeGuess(42, { value: ethers.parseEther("0.001") });
      
      expect(await contract.getPlayerAttempts(player1.address)).to.equal(0);
      expect(await contract.getPlayerHintsUsed(player1.address)).to.equal(0);
      expect(await contract.getPlayerBet(player1.address)).to.equal(0);
      expect(await contract.getTotalPlayers()).to.equal(0);
    });
  });
});
