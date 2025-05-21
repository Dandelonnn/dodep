const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Игровые данные
const games = new Map();
const players = new Map();
const waitingPlayers = [];

// WebSocket соединения
wss.on('connection', (ws) => {
  console.log('Новое подключение');
  
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    handleMessage(ws, data);
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});

function handleMessage(ws, data) {
  switch (data.type) {
    case 'REGISTER':
      registerPlayer(ws, data.name);
      break;
    case 'ROLL':
      handleRoll(ws, data.gameId);
      break;
    case 'NEW_GAME':
      startNewGame(data.gameId);
      break;
  }
}

function registerPlayer(ws, name) {
  const playerId = generateId();
  players.set(playerId, { ws, name, gameId: null });
  
  // Отправляем подтверждение
  ws.send(JSON.stringify({
    type: 'REGISTERED',
    playerId,
    name
  }));

  // Ищем игру для игрока
  if (waitingPlayers.length > 0) {
    const opponentId = waitingPlayers.pop();
    const opponent = players.get(opponentId);
    createGame(playerId, opponentId);
  } else {
    waitingPlayers.push(playerId);
    ws.send(JSON.stringify({
      type: 'WAITING'
    }));
  }
}

function createGame(player1Id, player2Id) {
  const gameId = generateId();
  const player1 = players.get(player1Id);
  const player2 = players.get(player2Id);
  
  player1.gameId = gameId;
  player2.gameId = gameId;
  
  const game = {
    id: gameId,
    players: [player1Id, player2Id],
    scores: [0, 0],
    wins: [0, 0],
    currentPlayer: Math.random() > 0.5 ? player1Id : player2Id,
    active: true,
    dice: ['🎲', '🎲'],
    history: [`Игра началась! Первым ходит ${players.get(currentPlayer).name}`]
  };
  
  games.set(gameId, game);
  
  // Уведомляем игроков
  notifyPlayers(gameId);
}

function handleRoll(ws, gameId) {
  const game = games.get(gameId);
  if (!game || !game.active) return;
  
  const playerId = [...players.entries()]
    .find(([id, p]) => p.ws === ws)[0];
  
  if (game.currentPlayer !== playerId) return;
  
  // Бросок костей
  const roll1 = Math.floor(Math.random() * 6) + 1;
  const roll2 = Math.floor(Math.random() * 6) + 1;
  const total = roll1 + roll2;
  
  // Эмодзи костей
  const diceEmojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const diceResult = diceEmojis[roll1 - 1] + diceEmojis[roll2 - 1];
  
  // Обновляем игру
  const playerIndex = game.players.indexOf(playerId);
  game.scores[playerIndex] += total;
  game.dice[playerIndex] = diceResult;
  
  // Проверяем победу
  if (game.scores[playerIndex] >= 50) {
    game.active = false;
    game.wins[playerIndex]++;
    game.history.unshift(`🎉 ${players.get(playerId).name} побеждает с ${game.scores[playerIndex]} очками!`);
  } else {
    // Передаем ход
    game.currentPlayer = game.players.find(id => id !== playerId);
    game.history.unshift(`${players.get(playerId).name} выбросил ${roll1} и ${roll2} (всего ${total})`);
  }
  
  notifyPlayers(gameId);
}

function startNewGame(gameId) {
  const game = games.get(gameId);
  if (!game) return;
  
  game.scores = [0, 0];
  game.dice = ['🎲', '🎲'];
  game.currentPlayer = game.players[Math.floor(Math.random() * 2)];
  game.active = true;
  game.history.unshift(`Новая игра! Первым ходит ${players.get(game.currentPlayer).name}`);
  
  notifyPlayers(gameId);
}

function handleDisconnect(ws) {
  const playerId = [...players.entries()]
    .find(([id, p]) => p.ws === ws)?.[0];
  
  if (!playerId) return;
  
  const player = players.get(playerId);
  if (player.gameId) {
    const game = games.get(player.gameId);
    if (game) {
      const opponentId = game.players.find(id => id !== playerId);
      if (opponentId) {
        const opponent = players.get(opponentId);
        opponent.ws.send(JSON.stringify({
          type: 'OPPONENT_DISCONNECTED'
        }));
      }
      games.delete(player.gameId);
    }
  }
  
  players.delete(playerId);
  const waitingIndex = waitingPlayers.indexOf(playerId);
  if (waitingIndex !== -1) {
    waitingPlayers.splice(waitingIndex, 1);
  }
}

function notifyPlayers(gameId) {
  const game = games.get(gameId);
  if (!game) return;
  
  game.players.forEach(playerId => {
    const player = players.get(playerId);
    if (player) {
      const playerIndex = game.players.indexOf(playerId);
      const opponentIndex = playerIndex === 0 ? 1 : 0;
      
      player.ws.send(JSON.stringify({
        type: 'GAME_UPDATE',
        game: {
          id: game.id,
          player1: {
            id: game.players[0],
            name: players.get(game.players[0]).name,
            score: game.scores[0],
            dice: game.dice[0],
            wins: game.wins[0]
          },
          player2: {
            id: game.players[1],
            name: players.get(game.players[1]).name,
            score: game.scores[1],
            dice: game.dice[1],
            wins: game.wins[1]
          },
          currentPlayer: game.currentPlayer,
          active: game.active,
          history: game.history
        },
        yourIndex: playerIndex,
        yourTurn: game.currentPlayer === playerId && game.active
      }));
    }
  });
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Статический сервер для клиентских файлов
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});