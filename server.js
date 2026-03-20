const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const COLORS = ["red", "orange", "blue", "green"];

let rooms = [];

app.use(express.static(path.join(__dirname, "public")));

function createId() {
  return crypto.randomUUID();
}

function getPublicRoomList() {
  return rooms.map((room) => ({
    roomId: room.roomId,
    roomName: room.roomName,
    count: room.players.length,
    max: MAX_PLAYERS,
    isFull: room.players.length >= MAX_PLAYERS
  }));
}

function getRoomState(room) {
  return {
    type: "room_state",
    roomId: room.roomId,
    roomName: room.roomName,
    count: room.players.length,
    max: MAX_PLAYERS,
    players: room.players
      .slice()
      .sort((a, b) => a.colorIndex - b.colorIndex)
      .map((p) => ({
        seat: p.colorIndex + 1,
        playerId: p.playerId,
        name: p.name,
        color: COLORS[p.colorIndex]
      })),
    grid: room.grid || {}
  };
}

function broadcastRoomList() {
  const message = JSON.stringify({
    type: "room_list",
    rooms: getPublicRoomList()
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastRoomState(room) {
  const message = JSON.stringify(getRoomState(room));

  room.players.forEach((player) => {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  });
}

function findRoomById(roomId) {
  return rooms.find((room) => room.roomId === roomId);
}

function findPlayerInRoom(room, playerId) {
  return room.players.find((player) => player.playerId === playerId);
}

function getAvailableColorIndex(room) {
  const usedIndexes = room.players.map((p) => p.colorIndex);

  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!usedIndexes.includes(i)) {
      return i;
    }
  }

  return -1;
}

function removePlayerByPlayerId(room, playerId) {
  const target = room.players.find((player) => player.playerId === playerId);
  if (target && target.disconnectTimer) {
    clearTimeout(target.disconnectTimer);
    target.disconnectTimer = null;
  }

  const before = room.players.length;
  room.players = room.players.filter((player) => player.playerId !== playerId);

  if (room.players.length !== before) {
    if (room.players.length > 0) {
      broadcastRoomState(room);
    } else {
      rooms = rooms.filter((r) => r.roomId !== room.roomId);
    }
    broadcastRoomList();
  }
}

function removeWsFromRooms(ws) {
  let changedRooms = [];

  rooms.forEach((room) => {
    const matchedPlayers = room.players.filter((player) => player.ws === ws);
    matchedPlayers.forEach((player) => {
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }
    });

    const before = room.players.length;
    room.players = room.players.filter((player) => player.ws !== ws);

    if (room.players.length !== before) {
      changedRooms.push(room);
    }
  });

  changedRooms.forEach((room) => {
    if (room.players.length > 0) {
      broadcastRoomState(room);
    }
  });

  const beforeCount = rooms.length;
  rooms = rooms.filter((room) => room.players.length > 0);

  if (changedRooms.length > 0 || rooms.length !== beforeCount) {
    broadcastRoomList();
  }
}

function scheduleDisconnectRemoval(ws) {
  rooms.forEach((room) => {
    const player = room.players.find((p) => p.ws === ws);
    if (!player) return;

    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
    }

    player.disconnectTimer = setTimeout(() => {
      removePlayerByPlayerId(room, player.playerId);
    }, 5000);
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({
    type: "room_list",
    rooms: getPublicRoomList()
  }));

  ws.on("message", (raw) => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (data.type === "create_room") {
      const ownerName = String(data.ownerName || "").trim();

      if (!ownerName) {
        ws.send(JSON.stringify({
          type: "create_room_error",
          message: "名字不能空白"
        }));
        return;
      }

      removeWsFromRooms(ws);

      const roomId = createId();
      const playerId = createId();

      const room = {
        roomId,
        roomName: `${ownerName}的房間`,
        players: [
          {
            playerId,
            name: ownerName,
            ws,
            colorIndex: 0,
            disconnectTimer: null
          }
        ],
        grid: {}
      };

      rooms.push(room);

      ws.send(JSON.stringify({
        type: "entered_room",
        roomId: room.roomId,
        roomName: room.roomName,
        playerId,
        playerName: ownerName
      }));

      broadcastRoomState(room);
      broadcastRoomList();
      return;
    }

    if (data.type === "join_room") {
      const roomId = String(data.roomId || "").trim();
      const playerName = String(data.playerName || "").trim();

      if (!roomId || !playerName) {
        ws.send(JSON.stringify({
          type: "join_error",
          message: "資料不完整"
        }));
        return;
      }

      const room = findRoomById(roomId);

      if (!room) {
        ws.send(JSON.stringify({
          type: "join_error",
          message: "房間不存在"
        }));
        return;
      }

      const colorIndex = getAvailableColorIndex(room);

      if (colorIndex === -1 || room.players.length >= MAX_PLAYERS) {
        ws.send(JSON.stringify({
          type: "room_full",
          message: "房間已滿"
        }));
        return;
      }

      removeWsFromRooms(ws);

      const playerId = createId();

      room.players.push({
        playerId,
        name: playerName,
        ws,
        colorIndex,
        disconnectTimer: null
      });

      ws.send(JSON.stringify({
        type: "entered_room",
        roomId: room.roomId,
        roomName: room.roomName,
        playerId,
        playerName
      }));

      broadcastRoomState(room);
      broadcastRoomList();
      return;
    }

    if (data.type === "rejoin_room") {
      const roomId = String(data.roomId || "").trim();
      const playerId = String(data.playerId || "").trim();
      const playerName = String(data.playerName || "").trim();

      if (!roomId || !playerId) {
        return;
      }

      const room = findRoomById(roomId);
      if (!room) {
        ws.send(JSON.stringify({
          type: "rejoin_failed",
          message: "房間不存在"
        }));
        return;
      }

      const player = findPlayerInRoom(room, playerId);
      if (!player) {
        ws.send(JSON.stringify({
          type: "rejoin_failed",
          message: "玩家不存在"
        }));
        return;
      }

      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }

      if (player.ws && player.ws !== ws && player.ws.readyState === WebSocket.OPEN) {
        try {
          player.ws.close();
        } catch (e) {}
      }

      player.ws = ws;
      if (playerName) {
        player.name = playerName;
      }

      ws.send(JSON.stringify({
        type: "entered_room",
        roomId: room.roomId,
        roomName: room.roomName,
        playerId: player.playerId,
        playerName: player.name
      }));

      broadcastRoomState(room);
      broadcastRoomList();
      return;
    }

    if (data.type === "leave_room") {
      rooms.forEach((room) => {
        const player = room.players.find((p) => p.ws === ws);
        if (player && player.disconnectTimer) {
          clearTimeout(player.disconnectTimer);
          player.disconnectTimer = null;
        }
      });

      removeWsFromRooms(ws);

      ws.send(JSON.stringify({
        type: "left_room"
      }));

      ws.send(JSON.stringify({
        type: "room_list",
        rooms: getPublicRoomList()
      }));
      return;
    }

    if (data.type === "click_cell") {
      const roomId = String(data.roomId || "").trim();
      const floor = String(data.floor || "").trim();
      const pos = String(data.pos || "").trim();

      const room = findRoomById(roomId);
      if (!room) return;

      const player = room.players.find((p) => p.ws === ws);
      if (!player) return;

      const key = `${floor}-${pos}`;
      room.grid[key] = player.colorIndex;

      broadcastRoomState(room);
      return;
    }

    if (data.type === "reset_grid") {
      const roomId = String(data.roomId || "").trim();
      const room = findRoomById(roomId);
      if (!room) return;

      room.grid = {};
      broadcastRoomState(room);
      return;
    }
  });

  ws.on("close", () => {
    scheduleDisconnectRemoval(ws);
  });

  ws.on("error", () => {});
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});