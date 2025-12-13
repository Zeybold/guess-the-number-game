"use client";

import { useState } from "react";
import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import { decodeEventLog } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { BugAntIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";

type DecodedLog = {
  eventName: string;
  args: Record<string, any>;
};

const Home = () => {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient();
  const { targetNetwork } = useTargetNetwork();

  const guessTheNumberAbi = (deployedContracts as any)?.[targetNetwork.id]?.GuessTheNumber?.abi ?? [];

  // === READ: Расширенный статус игры ===
  const { data: gameStatus } = useScaffoldReadContract({
    contractName: "GuessTheNumber",
    functionName: "getGameStatusExtended",
    watch: true,
  });

  const [
    owner,
    guessMaster,
    numberIsSet = false,
    totalAttempts = 0n,
    maxAttempts = 0n,
    prizePool = 0n,
    remainingAttempts = 0n,
    remainingHints = 0n,
    hintCost = 0n,
    maxHintsPerGame = 0n,
  ] = gameStatus || [];

  // === READ: Лимиты ставок ===
  const { data: minBetWei } = useScaffoldReadContract({
    contractName: "GuessTheNumber",
    functionName: "minBet",
    watch: true,
  });

  const { data: maxBetWei } = useScaffoldReadContract({
    contractName: "GuessTheNumber",
    functionName: "maxBet",
    watch: true,
  });

  // === STATES ===
  const [guess, setGuess] = useState("");
  const [betEth, setBetEth] = useState("0.001");
  const [hintGuess, setHintGuess] = useState("");
  const [error, setError] = useState("");

  const [gameResult, setGameResult] = useState<{
    show: boolean;
    isWin: boolean;
    guess?: string;
    message?: string;
    source?: string; // "guess" или "hint"
  }>({ show: false, isWin: false });

  const [hintResult, setHintResult] = useState<{
    show: boolean;
    guess: string;
    direction: string;
  }>({ show: false, guess: "", direction: "" });

  // === WRITE: Угадать число ===
  const { writeContractAsync: makeGuessWrite, isPending: guessPending } = useScaffoldWriteContract("GuessTheNumber");

  // === WRITE: Использовать подсказку ===
  const { writeContractAsync: hintWrite, isPending: hintPending } = useScaffoldWriteContract("GuessTheNumber");

  // === WRITE: Админ функции ===
  const { writeContractAsync: adminWrite, isPending: adminPending } = useScaffoldWriteContract("GuessTheNumber");

  // Проверка ролей
  const isOwner = connectedAddress?.toLowerCase() === owner?.toLowerCase();
  const isGuessMaster = connectedAddress?.toLowerCase() === guessMaster?.toLowerCase();

  // Форматирование ETH
  const formatEth = (wei: bigint | undefined) => (wei ? (Number(wei) / 1e18).toFixed(4) : "0");

  // === Обработчик ставки ===
  const handleGuess = async () => {
    setError("");
    setGameResult({ show: false, isWin: false });
    const guessNum = Number(guess);
    const betWei = BigInt(Math.floor(Number(betEth) * 1e18));

    if (!connectedAddress) return setError("Подключите кошелек");
    if (!numberIsSet) return setError("Ведущий не установил число!");
    if (isGuessMaster) return setError("Ведущий не может угадывать!");
    if (guessNum < 1 || guessNum > 100) return setError("Число должно быть от 1 до 100");
    if (Number(betEth) < Number(formatEth(minBetWei)))
      return setError(`Минимальная ставка: ${formatEth(minBetWei)} ETH`);
    if (Number(betEth) > Number(formatEth(maxBetWei)))
      return setError(`Максимальная ставка: ${formatEth(maxBetWei)} ETH`);
    if (totalAttempts >= maxAttempts) return setError("Попытки закончились!");

    try {
      const txHash = await makeGuessWrite({
        functionName: "makeGuess",
        args: [BigInt(guessNum)],
        value: betWei,
      });

      // Декодируем событие GuessAttempt
      if (publicClient && txHash && guessTheNumberAbi.length) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as any });

        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: guessTheNumberAbi,
              data: log.data,
              topics: log.topics,
            }) as unknown as DecodedLog;

            if (decoded.eventName === "GuessAttempt") {
              const args: any = decoded.args;
              if ((args.player as string)?.toLowerCase?.() === connectedAddress.toLowerCase()) {
                const isCorrect = args.isCorrect as boolean;

                setGameResult({
                  show: true,
                  isWin: isCorrect,
                  guess: guessNum.toString(),
                  message: isCorrect
                    ? "✅ ВЫ УГАДАЛИ!"
                    : `❌ Неверно! (попыток осталось: ${Number(remainingAttempts) - 1})`,
                  source: "guess",
                });

                setTimeout(() => {
                  setGameResult({ show: false, isWin: false });
                }, 6000);

                break;
              }
            }
          } catch {
            // пропускаем
          }
        }
      }

      setGuess("");
      setBetEth("0.001");
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Ошибка транзакции";
      setError(msg);
    }
  };

  // === Обработчик подсказки ===
  const handleHint = async () => {
    setError("");
    const hintGuessNum = Number(hintGuess);
    const hintCostWei = hintCost ?? 0n;

    if (!connectedAddress) return setError("Подключите кошелек");
    if (!numberIsSet) return setError("Ведущий не установил число!");
    if (isGuessMaster) return setError("Ведущий не может просить подсказки!");
    if (hintGuessNum < 1 || hintGuessNum > 100) return setError("Число должно быть от 1 до 100");
    if (remainingHints && Number(remainingHints) <= 0) return setError("Подсказки закончились!");
    if (totalAttempts >= maxAttempts) return setError("Попытки закончились!");
    if (!prizePool || prizePool === 0n) return setError("Пул пустой!");
    if (hintCostWei <= 0n) return setError("Стоимость подсказки = 0");

    try {
      const txHash = await hintWrite({
        functionName: "useHint",
        args: [BigInt(hintGuessNum)],
        value: hintCostWei,
      });

      if (publicClient && txHash && guessTheNumberAbi.length) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as any });

        let foundEvent = false;

        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: guessTheNumberAbi,
              data: log.data,
              topics: log.topics,
            }) as unknown as DecodedLog;

            // Проверяем GuessAttempt (если угадали через подсказку)
            if (decoded.eventName === "GuessAttempt") {
              const args: any = decoded.args;
              if ((args.player as string)?.toLowerCase?.() === connectedAddress.toLowerCase()) {
                const isCorrect = args.isCorrect as boolean;

                if (isCorrect) {
                  // Показываем окно победы
                  setGameResult({
                    show: true,
                    isWin: true,
                    guess: hintGuessNum.toString(),
                    message: "✅ ВЫ УГАДАЛИ ЧЕРЕЗ ПОДСКАЗКУ!",
                    source: "hint",
                  });

                  setTimeout(() => {
                    setGameResult({ show: false, isWin: false });
                  }, 6000);

                  foundEvent = true;
                  break;
                }
              }
            }

            // Проверяем HintUsed (если не угадали)
            if (decoded.eventName === "HintUsed") {
              const args: any = decoded.args;
              if ((args.player as string)?.toLowerCase?.() === connectedAddress.toLowerCase()) {
                const directionText = args.isHigher ? "Загаданное число БОЛЬШЕ" : "Загаданное число МЕНЬШЕ";

                setHintResult({
                  show: true,
                  guess: hintGuessNum.toString(),
                  direction: directionText,
                });

                setTimeout(() => {
                  setHintResult({ show: false, guess: "", direction: "" });
                }, 5000);

                foundEvent = true;
                break;
              }
            }
          } catch {
            // пропускаем
          }
        }

        if (!foundEvent) {
          setHintResult({
            show: true,
            guess: hintGuessNum.toString(),
            direction: "Подсказка получена",
          });
          setTimeout(() => setHintResult({ show: false, guess: "", direction: "" }), 5000);
        }
      } else {
        setHintResult({
          show: true,
          guess: hintGuessNum.toString(),
          direction: "Подсказка получена",
        });
        setTimeout(() => setHintResult({ show: false, guess: "", direction: "" }), 5000);
      }

      setHintGuess("");
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Ошибка транзакции";
      setError(msg);
    }
  };

  // === Админские функции ===
  const [newGuessMaster, setNewGuessMaster] = useState("");
  const [secretNumber, setSecretNumber] = useState("");

  const handleSetGuessMaster = async () => {
    if (!isOwner) return setError("Только Владелец!");
    if (!newGuessMaster) return setError("Введите адрес");
    if (numberIsSet) return setError("Игра началась - менять ведущего нельзя!");

    try {
      setError("");
      await adminWrite({
        functionName: "setGuessMaster",
        args: [newGuessMaster as `0x${string}`],
      });
      setNewGuessMaster("");
    } catch (e: any) {
      setError(e?.shortMessage || "Ошибка");
    }
  };

  const handleSetSecretNumber = async () => {
    if (!isGuessMaster) return setError("Только Ведущий!");
    const num = Number(secretNumber);
    if (num < 1 || num > 100) return setError("Число: 1-100");

    try {
      setError("");
      await adminWrite({
        functionName: "setSecretNumber",
        args: [BigInt(num)],
      });
      setSecretNumber("");
    } catch (e: any) {
      setError(e?.shortMessage || "Ошибка");
    }
  };

  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="px-5 w-full max-w-4xl">
        <h1 className="text-center">
          <span className="block text-2xl mb-2">Игра</span>
          <span className="block text-4xl font-bold text-primary">«Угадай число» (одно число, заданное заранее)</span>
        </h1>

        <div className="flex justify-center items-center space-x-2 flex-col mt-6 p">
          <p className="my-2 font-medium">
            Адрес: {connectedAddress ? <Address address={connectedAddress} chain={targetNetwork} /> : "—"}
          </p>

          <div className="badge badge-secondary">
            {isOwner && isGuessMaster ? "Владелец игры" : isGuessMaster ? "Ведущий" : "Игрок"}
          </div>
        </div>

        {/* Статус */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-8">
          <div className="stats shadow bg-base-100">
            <div className="stat">
              <div className="stat-title">Пул</div>
              <div className="stat-value text-primary text-xl">{formatEth(prizePool)} ETH</div>
            </div>
          </div>

          <div className="stats shadow bg-base-100">
            <div className="stat">
              <div className="stat-title">Попыток</div>
              <div className="stat-value text-lg">
                {totalAttempts}/{maxAttempts}
              </div>
            </div>
          </div>

          <div className="stats shadow bg-base-100">
            <div className="stat">
              <div className="stat-title">Подсказок</div>
              <div className="stat-value text-lg text-warning">
                {remainingHints}/{maxHintsPerGame}
              </div>
            </div>
          </div>
        </div>

        {/* Игровая панель */}
        {!isGuessMaster ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
            {/* Ставка */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title">🎲 Угадать</h2>

                {!numberIsSet && <div className="alert alert-info alert-sm">Ведущий не установил число</div>}

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Число (1-100)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={guess}
                    onChange={e => setGuess(e.target.value)}
                    className="input input-bordered w-full"
                    placeholder="42"
                    disabled={!numberIsSet || totalAttempts >= maxAttempts}
                  />
                </div>

                <div className="form-control mt-4">
                  <label className="label">
                    <span className="label-text">Ставка (ETH)</span>
                    <span className="label-text-alt text-xs">
                      {formatEth(minBetWei)} - {formatEth(maxBetWei)} ETH
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={betEth}
                    onChange={e => setBetEth(e.target.value)}
                    className="input input-bordered w-full"
                    placeholder="0.001"
                    disabled={!numberIsSet || totalAttempts >= maxAttempts}
                  />
                </div>

                <button
                  className="btn btn-primary btn-lg mt-6"
                  onClick={handleGuess}
                  disabled={
                    guessPending || !numberIsSet || !connectedAddress || totalAttempts >= maxAttempts || isGuessMaster
                  }
                >
                  {guessPending ? "⏳ Отправка..." : "🎯 Сделать ставку"}
                </button>
              </div>
            </div>

            {/* Подсказка */}
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body">
                <h2 className="card-title">💡 Подсказка</h2>

                <p className="text-sm opacity-70">
                  Стоимость: <b>{formatEth(hintCost)} ETH</b> (удвоит пул)
                </p>

                {!numberIsSet && <div className="alert alert-info alert-sm">Ведущий не установил число</div>}
                {prizePool === 0n && <div className="alert alert-warning alert-sm">Пул пустой</div>}

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Ваше число</span>
                    <span className="label-text-alt">Осталось: {remainingHints}</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={hintGuess}
                    onChange={e => setHintGuess(e.target.value)}
                    className="input input-bordered w-full"
                    placeholder="50"
                    disabled={
                      !numberIsSet ||
                      totalAttempts >= maxAttempts ||
                      prizePool === 0n ||
                      Number(remainingHints ?? 0) <= 0
                    }
                  />
                </div>

                <button
                  className="btn btn-warning btn-lg mt-6"
                  onClick={handleHint}
                  disabled={
                    hintPending ||
                    !numberIsSet ||
                    !connectedAddress ||
                    totalAttempts >= maxAttempts ||
                    Number(remainingHints ?? 0) <= 0 ||
                    prizePool === 0n ||
                    isGuessMaster
                  }
                >
                  {hintPending ? "⏳ Отправка..." : "💡 Получить"}
                </button>

                {/* Показываем, если подсказки закончились */}
                {Number(remainingHints ?? 0) <= 0 ? (
                  <p className="text-xs text-error mt-2">❌ Подсказки закончились</p>
                ) : (
                  <p className="text-xs opacity-60 mt-2">Подсказка: -1 попытка, -1 подсказка</p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Панель ведущего */}
        {isGuessMaster ? (
          <div className="card bg-base-100 shadow-xl mt-8 border-2 border-warning">
            <div className="card-body">
              <h2 className="card-title">🎮 Панель Ведущего</h2>

              <div className="alert alert-info">
                <span>✅ Вы назначены Ведущим. После окончания игры роль вернется Владельцу.</span>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Установить число (1-100)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={secretNumber}
                  onChange={e => setSecretNumber(e.target.value)}
                  className="input input-bordered w-full"
                  placeholder="42"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {numberIsSet && totalAttempts > 0
                    ? "⚠️ Переустановка сбросит попытки/подсказки, но пул останется!"
                    : ""}
                </p>
                <button
                  className="btn btn-success mt-2"
                  onClick={handleSetSecretNumber}
                  disabled={adminPending || !secretNumber}
                >
                  {adminPending ? "⏳ Отправка..." : "✅ Установить"}
                </button>
              </div>

              {numberIsSet ? (
                <div className="alert alert-success mt-4">
                  ✅ Число установлено и скрыто. Пул: {formatEth(prizePool)} ETH
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Панель Владельца - показывается если он ведущий */}
        {isOwner && isGuessMaster ? (
          <div className="card bg-base-100 shadow-xl mt-8 border-2 border-success">
            <div className="card-body">
              <h2 className="card-title">👑 Панель Владельца</h2>

              {numberIsSet ? (
                <div className="alert alert-warning">⚠️ Игра началась. Менять ведущего нельзя!</div>
              ) : (
                <div>
                  <label className="label">
                    <span className="label-text">Назначить Ведущего</span>
                  </label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={newGuessMaster}
                    onChange={e => setNewGuessMaster(e.target.value)}
                    className="input input-bordered w-full"
                  />
                  <button
                    className="btn btn-info mt-2"
                    onClick={handleSetGuessMaster}
                    disabled={adminPending || !newGuessMaster || numberIsSet}
                  >
                    {adminPending ? "⏳ Отправка..." : "✅ Назначить"}
                  </button>
                </div>
              )}

              <div className="divider"></div>

              <p className="text-sm opacity-70">
                Текущий Ведущий: <Address address={guessMaster} chain={targetNetwork} />
              </p>
            </div>
          </div>
        ) : null}

        {/* Ошибка */}
        {error ? (
          <div className="alert alert-error mt-6">
            <span>{error}</span>
            <button onClick={() => setError("")} className="btn btn-sm">
              OK
            </button>
          </div>
        ) : null}

        {/* Модаль результата ставки */}
        {gameResult.show ? (
          <div className="modal modal-open">
            <div className={`modal-box ${gameResult.isWin ? "border-4 border-success" : "border-4 border-error"}`}>
              <h3 className={`font-bold text-3xl mb-4 ${gameResult.isWin ? "text-success" : "text-error"}`}>
                {gameResult.isWin ? "🎉 ПОБЕДА!" : "❌ Неверно"}
              </h3>
              <p className="py-4 text-xl">
                Ваше число: <b className="text-xl">{gameResult.guess}</b>
              </p>
              <p className="text-lg">{gameResult.message}</p>
              <div className="modal-action">
                <button className="btn btn-primary" onClick={() => setGameResult({ show: false, isWin: false })}>
                  OK
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Модаль подсказки */}
        {hintResult.show ? (
          <div className="modal modal-open">
            <div className="modal-box border-4 border-warning">
              <h3 className="font-bold text-3xl mb-4 text-warning">💡 ПОДСКАЗКА</h3>
              <p className="py-4 text-xl">
                Число <b className="text-xl">{hintResult.guess}</b>:
              </p>
              <p className="text-lg font-bold text-warning">{hintResult.direction}</p>
              <div className="modal-action">
                <button
                  className="btn btn-warning"
                  onClick={() => setHintResult({ show: false, guess: "", direction: "" })}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Ссылки */}
        <div className="grow bg-base-300 w-full mt-16 px-8 py-12 rounded-3xl">
          <div className="flex justify-center items-center gap-12 flex-col md:flex-row">
            <div className="flex flex-col bg-base-100 px-10 py-10 text-center items-center max-w-xs rounded-3xl">
              <BugAntIcon className="h-8 w-8 fill-secondary" />
              <p>
                <Link href="/debug" className="link">
                  Debug
                </Link>
              </p>
            </div>

            <div className="flex flex-col bg-base-100 px-10 py-10 text-center items-center max-w-xs rounded-3xl">
              <MagnifyingGlassIcon className="h-8 w-8 fill-secondary" />
              <p>
                <Link href="https://sepolia.etherscan.io" className="link" target="_blank">
                  Block Explorer
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
