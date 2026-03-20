const createRoomInput = document.getElementById("createRoomInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const roomsDiv = document.getElementById("rooms");
const hintDiv = document.getElementById("hint");

const lobbyPage = document.getElementById("lobbyPage");
const roomPage = document.getElementById("roomPage");
const roomTitle = document.getElementById("roomTitle");
const roomCount = document.getElementById("roomCount");
const myName = document.getElementById("myName");
const playersDiv = document.getElementById("players");
const leaveBtn = document.getElementById("leaveBtn");
const resetBtn = document.getElementById("resetBtn");
const floorsDiv = document.getElementById("floors");

const protocol = location.protocol === "https:" ? "wss" : "ws";
let ws = null;

let currentRoomId = sessionStorage.getItem("room_id") || "";
let currentPlayerId = sessionStorage.getItem("player_id") || "";
let currentPlayerName = sessionStorage.getItem("player_name") || "";

const COLOR_MAP = {
  red: "red",
  orange: "orange",
  blue: "blue",
  green: "green"
};

function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text;
  return div.innerHTML;
}

function updateCreateButton() {
  createRoomBtn.disabled = createRoomInput.value.trim() === "";
}

function showLobby() {
  lobbyPage.style.display = "block";
  roomPage.style.display = "none";
}

function showRoom() {
  lobbyPage.style.display = "none";
  roomPage.style.display = "block";
}

function saveSession() {
  sessionStorage.setItem("room_id", currentRoomId);
  sessionStorage.setItem("player_id", currentPlayerId);
  sessionStorage.setItem("player_name", currentPlayerName);
}

function clearSession() {
  sessionStorage.removeItem("room_id");
  sessionStorage.removeItem("player_id");
  sessionStorage.removeItem("player_name");
}

function renderRooms(rooms) {
  roomsDiv.innerHTML = "";

  if (rooms.length === 0) {
    roomsDiv.innerHTML = `<div style="font-size:22px;color:#666;">目前沒有房間</div>`;
    return;
  }

  rooms.forEach((room) => {
    const roomCard = document.createElement("div");
    roomCard.className = "room-card";

    roomCard.innerHTML = `
      <div class="room-header">
        <div class="room-name">${escapeHtml(room.roomName)}</div>
        <div class="room-count">目前人數：${room.count}/${room.max}</div>
      </div>
      <div class="join-row">
        <input type="text" class="join-name-input" placeholder="輸入你的名字" data-room-id="${room.roomId}">
        <button class="join-btn" data-room-id="${room.roomId}" ${room.isFull ? "disabled" : ""}>加入</button>
      </div>
    `;

    roomsDiv.appendChild(roomCard);
  });

  bindJoinEvents();
}

function bindJoinEvents() {
  const joinButtons = document.querySelectorAll(".join-btn");

  joinButtons.forEach((button) => {
    const roomId = button.dataset.roomId;
    const input = document.querySelector(`.join-name-input[data-room-id="${roomId}"]`);
    const isRoomFull = button.disabled; // 只有 renderRooms 時決定是否房滿

    if (!isRoomFull) {
      button.disabled = !input.value.trim();
    }

    input.addEventListener("input", () => {
      if (!isRoomFull) {
        button.disabled = !input.value.trim();
      }
    });

    button.addEventListener("click", () => {
      const playerName = input.value.trim();
      if (!playerName || button.disabled || !ws) return;

      hintDiv.innerText = "";
      ws.send(JSON.stringify({
        type: "join_room",
        roomId,
        playerName
      }));
    });
  });
}

function renderPlayers(players) {
  playersDiv.innerHTML = "";

  players.forEach((player) => {
    const div = document.createElement("div");
    const isMe = player.playerId === currentPlayerId ? "（你）" : "";
    const color = COLOR_MAP[player.color] || "gray";

    div.className = "player-item";
    div.innerHTML = `
      <span class="player-dot" style="background:${color};"></span>
      <span>${player.seat}. ${escapeHtml(player.name)}${isMe}</span>
    `;

    playersDiv.appendChild(div);
  });
}

function renderFloors() {
  floorsDiv.innerHTML = "";

  for (let floor = 10; floor >= 1; floor--) {
    const div = document.createElement("div");
    div.className = "floor";

    div.innerHTML = `
      <div class="floor-label">${floor}</div>
      <div class="buttons">
        ${[1, 2, 3, 4].map((n) => `
          <button class="btn" data-floor="${floor}" data-pos="${n}">
            ${n}
          </button>
        `).join("")}
      </div>
    `;

    floorsDiv.appendChild(div);
  }
}

function applyGrid(grid) {
  const colors = ["red", "orange", "blue", "green"];

  document.querySelectorAll(".btn").forEach((btn) => {
    const key = `${btn.dataset.floor}-${btn.dataset.pos}`;
    const colorIndex = grid[key];

    if (colorIndex !== undefined) {
      btn.style.background = colors[colorIndex];
    } else {
      btn.style.background = "#555";
    }
  });
}

function connectSocket() {
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => {
    if (currentRoomId && currentPlayerId) {
      ws.send(JSON.stringify({
        type: "rejoin_room",
        roomId: currentRoomId,
        playerId: currentPlayerId,
        playerName: currentPlayerName
      }));
    }
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "room_list") {
      if (!currentRoomId) {
        renderRooms(data.rooms);
      }
      return;
    }

    if (data.type === "entered_room") {
      currentRoomId = data.roomId;
      currentPlayerId = data.playerId;
      currentPlayerName = data.playerName;

      saveSession();

      myName.innerText = currentPlayerName;
      roomTitle.innerText = data.roomName;
      hintDiv.innerText = "";

      showRoom();
      renderFloors();
      return;
    }

    if (data.type === "room_state") {
      if (currentRoomId && data.roomId === currentRoomId) {
        roomTitle.innerText = data.roomName;
        roomCount.innerText = `目前人數：${data.count}/${data.max}`;
        renderPlayers(data.players);

        if (!document.querySelector(".btn")) {
          renderFloors();
        }

        applyGrid(data.grid || {});
        showRoom();
      }
      return;
    }

    if (data.type === "left_room") {
      currentRoomId = "";
      currentPlayerId = "";
      currentPlayerName = "";
      clearSession();

      playersDiv.innerHTML = "";
      floorsDiv.innerHTML = "";
      roomTitle.innerText = "";
      roomCount.innerText = "";

      showLobby();
      return;
    }

    if (data.type === "rejoin_failed") {
      currentRoomId = "";
      currentPlayerId = "";
      currentPlayerName = "";
      clearSession();
      showLobby();
      return;
    }

    if (
      data.type === "room_full" ||
      data.type === "join_error" ||
      data.type === "create_room_error"
    ) {
      hintDiv.innerText = data.message || "操作失敗";
    }
  };

  ws.onclose = () => {
    if (currentRoomId && currentPlayerId) {
      setTimeout(() => {
        connectSocket();
      }, 800);
    } else {
      hintDiv.innerText = "連線已中斷";
    }
  };
}

createRoomInput.addEventListener("input", updateCreateButton);

createRoomBtn.addEventListener("click", () => {
  const ownerName = createRoomInput.value.trim();
  if (!ownerName || !ws) return;

  hintDiv.innerText = "";
  ws.send(JSON.stringify({
    type: "create_room",
    ownerName
  }));
});

leaveBtn.addEventListener("click", () => {
  if (!ws) return;

  ws.send(JSON.stringify({
    type: "leave_room"
  }));
});

resetBtn.addEventListener("click", () => {
  if (!currentRoomId || !ws) return;

  ws.send(JSON.stringify({
    type: "reset_grid",
    roomId: currentRoomId
  }));
});

document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("btn")) return;
  if (!currentRoomId || !ws) return;

  const floor = e.target.dataset.floor;
  const pos = e.target.dataset.pos;

  ws.send(JSON.stringify({
    type: "click_cell",
    roomId: currentRoomId,
    floor,
    pos
  }));
});

updateCreateButton();

if (currentRoomId && currentPlayerId) {
  showRoom();
  renderFloors();
} else {
  showLobby();
}

connectSocket();