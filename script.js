import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
    getAuth,
    signInAnonymously,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
    getDatabase,
    ref,
    get,
    set,
    update,
    remove,
    onValue,
    onDisconnect,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // excludes 0/O/1/I to avoid ambiguity
const ROOM_CODE_LENGTH = 4;
const EMPTY_BOARD = ["", "", "", "", "", "", "", "", ""];

const WIN_PATTERNS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6]             // Diagonals
];

// ---- DOM references ----
const lobbyScreen = document.getElementById("lobby-screen");
const roomScreen = document.getElementById("room-screen");
const displayNameInput = document.getElementById("display-name");
const createRoomBtn = document.getElementById("create-room-btn");
const joinCodeInput = document.getElementById("join-code-input");
const joinRoomBtn = document.getElementById("join-room-btn");
const lobbyError = document.getElementById("lobby-error");

const roomCodeText = document.getElementById("room-code-text");
const copyLinkBtn = document.getElementById("copy-link-btn");
const playerXName = document.getElementById("player-x-name");
const playerOName = document.getElementById("player-o-name");
const playerXDot = document.getElementById("player-x-dot");
const playerODot = document.getElementById("player-o-dot");
const statusLine = document.getElementById("status-line");
const cells = document.querySelectorAll(".cell");
const CELL_NAMES = ["top left", "top middle", "top right", "middle left", "center", "middle right", "bottom left", "bottom middle", "bottom right"];
const gameResult = document.getElementById("game-result");
const rematchBtn = document.getElementById("rematch-btn");
const leaveRoomBtn = document.getElementById("leave-room-btn");

// ---- Session state ----
let currentUid = null;
let authReadyPromise = null;
let roomCode = null;
let mySeat = null; // 'X' | 'O'
let roomUnsubscribe = null;
let presenceUnsubscribe = null;
let latestRoomData = null;

function checkWinner(board) {
    for (const [a, b, c] of WIN_PATTERNS) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    if (board.every((cell) => cell !== "")) {
        return "Tie";
    }
    return null;
}

function generateRoomCode() {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    return code;
}

function showLobbyError(message) {
    lobbyError.textContent = message;
}

function switchToRoomScreen() {
    lobbyScreen.classList.add("hidden");
    roomScreen.classList.remove("hidden");
}

function switchToLobbyScreen() {
    roomScreen.classList.add("hidden");
    lobbyScreen.classList.remove("hidden");
}

// ---- Auth (anonymous — no login UI, just gives rules a real uid to check) ----
function waitForAuth() {
    if (!authReadyPromise) {
        authReadyPromise = new Promise((resolve) => {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    currentUid = user.uid;
                    resolve(user.uid);
                }
            });
        });
        signInAnonymously(auth).catch((err) => {
            console.error("Anonymous sign-in failed", err);
            showLobbyError("Could not connect. Please refresh and try again.");
        });
    }
    return authReadyPromise;
}

// ---- Room lifecycle ----
async function createRoom() {
    const name = displayNameInput.value.trim();
    if (!name) {
        showLobbyError("Enter your name first.");
        return;
    }

    createRoomBtn.disabled = true;
    try {
        await waitForAuth();

        let code = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = generateRoomCode();
            const snapshot = await get(ref(db, `rooms/${candidate}`));
            if (!snapshot.exists()) {
                code = candidate;
                break;
            }
        }
        if (!code) {
            throw new Error("Could not allocate a room code, please try again.");
        }

        // Every leaf must be written as an explicit slash-path key. A set()/update()
        // with a nested object (e.g. `board: [...]`) is only checked against the
        // .write rule at that exact key's path — it never reaches the more specific
        // per-cell rules defined deeper at board/$cellIndex.
        const initialUpdates = {
            createdAt: serverTimestamp(),
            status: "waiting",
            turn: "X",
            startingMark: "X",
            "players/X/name": name,
            "players/X/uid": currentUid,
            "players/X/connected": true
        };
        EMPTY_BOARD.forEach((_, i) => {
            initialUpdates[`board/${i}`] = "";
        });
        await update(ref(db, `rooms/${code}`), initialUpdates);

        enterRoom(code, "X");
    } catch (err) {
        console.error(err);
        showLobbyError(err.message || "Failed to create room.");
    } finally {
        createRoomBtn.disabled = false;
    }
}

async function joinRoom() {
    const name = displayNameInput.value.trim();
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!name) {
        showLobbyError("Enter your name first.");
        return;
    }
    if (!code) {
        showLobbyError("Enter a room code.");
        return;
    }

    joinRoomBtn.disabled = true;
    try {
        await waitForAuth();

        const snapshot = await get(ref(db, `rooms/${code}`));
        if (!snapshot.exists()) {
            showLobbyError("Room not found.");
            return;
        }
        const room = snapshot.val();

        let seat = null;
        let isReconnect = false;
        if (room.players?.X?.uid === currentUid) {
            seat = "X";
            isReconnect = true;
        } else if (room.players?.O?.uid === currentUid) {
            seat = "O";
            isReconnect = true;
        } else if (!room.players?.X) {
            seat = "X";
        } else if (!room.players?.O) {
            seat = "O";
        } else {
            showLobbyError("Room is full.");
            return;
        }

        // Claim the seat first, then (in a separate write) flip status to "playing".
        // Keeping these as two sequential writes lets the status rule check that the
        // seat claim already landed — a single combined update() can't do that, because
        // security rules always evaluate against pre-write data, even for sibling paths
        // touched in the same multi-path update.
        await update(ref(db, `rooms/${code}`), {
            [`players/${seat}/name`]: name,
            [`players/${seat}/uid`]: currentUid,
            [`players/${seat}/connected`]: true
        });

        if (!isReconnect && seat === "O" && room.status === "waiting") {
            await update(ref(db, `rooms/${code}`), { status: "playing" });
        }

        enterRoom(code, seat);
    } catch (err) {
        console.error(err);
        showLobbyError(err.message || "Failed to join room.");
    } finally {
        joinRoomBtn.disabled = false;
    }
}

function enterRoom(code, seat) {
    roomCode = code;
    mySeat = seat;

    sessionStorage.setItem("ttt-room", JSON.stringify({ roomCode: code, seat }));
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    window.history.replaceState({}, "", url);

    watchPresence(code, seat);

    roomCodeText.textContent = code;
    switchToRoomScreen();
    subscribeToRoom(code);
}

function subscribeToRoom(code) {
    if (roomUnsubscribe) roomUnsubscribe();
    roomUnsubscribe = onValue(ref(db, `rooms/${code}`), (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            leaveRoomLocal();
            showLobbyError("This room no longer exists.");
            return;
        }
        latestRoomData = data;
        renderRoom(data);
    });
}

// Firebase reconnects on its own after a network blip, but by then onDisconnect has
// already marked us offline. Watching .info/connected re-marks us online (and re-arms
// onDisconnect) every time the connection comes back, not just on a page refresh.
function watchPresence(code, seat) {
    if (presenceUnsubscribe) presenceUnsubscribe();
    const connectedRef = ref(db, `rooms/${code}/players/${seat}/connected`);
    presenceUnsubscribe = onValue(ref(db, ".info/connected"), async (snapshot) => {
        if (snapshot.val() !== true) return;
        try {
            await onDisconnect(connectedRef).set(false);
            await set(connectedRef, true);
        } catch (err) {
            if (err.code !== "PERMISSION_DENIED") console.error("Presence update failed", err);
        }
    });
}

function leaveRoomLocal() {
    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }
    if (presenceUnsubscribe) {
        presenceUnsubscribe();
        presenceUnsubscribe = null;
    }
    roomCode = null;
    mySeat = null;
    latestRoomData = null;
    sessionStorage.removeItem("ttt-room");

    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url);

    switchToLobbyScreen();
}

// ---- Rendering ----
function renderRoom(data) {
    const board = data.board || EMPTY_BOARD;
    board.forEach((mark, i) => {
        cells[i].textContent = mark;
        cells[i].classList.remove("X", "O");
        if (mark) cells[i].classList.add(mark);
        cells[i].setAttribute("aria-label", `Square ${i + 1}, ${CELL_NAMES[i]}, ${mark || "empty"}`);
    });

    const xPlayer = data.players?.X;
    const oPlayer = data.players?.O;
    playerXName.textContent = xPlayer ? xPlayer.name : "Waiting…";
    playerOName.textContent = oPlayer ? oPlayer.name : "Waiting…";
    playerXDot.classList.toggle("connected", !!(xPlayer && xPlayer.connected));
    playerODot.classList.toggle("connected", !!(oPlayer && oPlayer.connected));

    const opponentSeat = mySeat === "X" ? "O" : "X";
    const opponent = data.players?.[opponentSeat];

    if (data.status === "waiting") {
        statusLine.textContent = "Waiting for opponent to join…";
    } else if (data.status === "playing") {
        if (opponent && opponent.connected === false) {
            statusLine.textContent = "Opponent disconnected — waiting for them to reconnect…";
        } else if (data.turn === mySeat) {
            statusLine.textContent = "Your turn";
        } else {
            statusLine.textContent = `Waiting for ${opponent ? opponent.name : "opponent"}…`;
        }
    } else {
        statusLine.textContent = "";
    }

    if (data.status === "finished") {
        if (data.winner === "Tie") {
            gameResult.textContent = "It's a Tie!";
        } else if (data.winner === mySeat) {
            gameResult.textContent = "You win!";
        } else {
            gameResult.textContent = `${data.winner} wins!`;
        }
        const myRematch = !!data.rematch?.[mySeat];
        rematchBtn.classList.remove("hidden");
        rematchBtn.disabled = myRematch;
        rematchBtn.textContent = myRematch ? "Waiting for opponent…" : "Rematch";
    } else {
        gameResult.textContent = "";
        rematchBtn.classList.add("hidden");
    }

    const canClick = data.status === "playing" && data.turn === mySeat;
    cells.forEach((cell, i) => {
        const disabled = !(canClick && board[i] === "");
        cell.classList.toggle("disabled", disabled);
        cell.setAttribute("aria-disabled", String(disabled));
    });

    // Seat X drives the rematch reset so only one client performs the write once both opt in.
    if (data.status === "finished" && data.rematch?.X && data.rematch?.O && mySeat === "X") {
        performRematchReset();
    }

    // Both clients compute the same result from the synced board; whichever notices first reports it.
    if (data.status === "playing") {
        const winner = checkWinner(board);
        if (winner) {
            reportGameEnd(winner);
        }
    }
}

async function reportGameEnd(winner) {
    try {
        await update(ref(db, `rooms/${roomCode}`), { status: "finished", winner });
    } catch (err) {
        if (err.code !== "PERMISSION_DENIED") console.error(err);
    }
}

async function performRematchReset() {
    try {
        const nextStarter = latestRoomData?.startingMark === "X" ? "O" : "X";
        const resetUpdates = {
            turn: nextStarter,
            startingMark: nextStarter,
            status: "playing",
            winner: null,
            "rematch/X": false,
            "rematch/O": false
        };
        EMPTY_BOARD.forEach((_, i) => {
            resetUpdates[`board/${i}`] = "";
        });
        await update(ref(db, `rooms/${roomCode}`), resetUpdates);
    } catch (err) {
        console.error(err);
    }
}

// ---- Player actions ----
async function handleCellClick(index) {
    if (!latestRoomData || !roomCode || !mySeat) return;
    if (latestRoomData.status !== "playing") return;
    if (latestRoomData.turn !== mySeat) return;
    if (latestRoomData.board[index] !== "") return;

    const nextTurn = mySeat === "X" ? "O" : "X";
    try {
        await update(ref(db, `rooms/${roomCode}`), {
            [`board/${index}`]: mySeat,
            turn: nextTurn
        });
    } catch (err) {
        console.error("Move rejected", err);
    }
}

cells.forEach((cell, index) => {
    cell.addEventListener("click", () => handleCellClick(index));
});

createRoomBtn.addEventListener("click", createRoom);
joinRoomBtn.addEventListener("click", joinRoom);

displayNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createRoomBtn.click();
});
joinCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoomBtn.click();
});

rematchBtn.addEventListener("click", async () => {
    if (!roomCode || !mySeat) return;
    try {
        await update(ref(db, `rooms/${roomCode}`), { [`rematch/${mySeat}`]: true });
    } catch (err) {
        console.error(err);
    }
});

leaveRoomBtn.addEventListener("click", async () => {
    if (roomCode && mySeat) {
        const code = roomCode;
        const seat = mySeat;
        const opponentSeat = seat === "X" ? "O" : "X";
        const opponent = latestRoomData?.players?.[opponentSeat];
        // Stop listening first so our own delete doesn't show "This room no longer exists."
        leaveRoomLocal();
        try {
            const connectedRef = ref(db, `rooms/${code}/players/${seat}/connected`);
            await onDisconnect(connectedRef).cancel();
            if (!opponent || opponent.connected === false) {
                // Nobody else is in the room, so delete it instead of leaving it behind.
                await remove(ref(db, `rooms/${code}`));
            } else {
                await set(connectedRef, false);
            }
        } catch (err) {
            console.error(err);
        }
        return;
    }
    leaveRoomLocal();
});

copyLinkBtn.addEventListener("click", async () => {
    if (!roomCode) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomCode);
    try {
        await navigator.clipboard.writeText(url.toString());
        const original = copyLinkBtn.textContent;
        copyLinkBtn.textContent = "Copied!";
        setTimeout(() => { copyLinkBtn.textContent = original; }, 1500);
    } catch (err) {
        console.error(err);
    }
});

// ---- Startup: prefill room code from a shared link, and silently rejoin after a refresh ----
(async function init() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
        joinCodeInput.value = roomParam.toUpperCase();
    }

    const saved = sessionStorage.getItem("ttt-room");
    if (!saved) return;

    try {
        const { roomCode: savedCode, seat: savedSeat } = JSON.parse(saved);
        await waitForAuth();
        const snapshot = await get(ref(db, `rooms/${savedCode}`));
        const room = snapshot.val();
        if (room && room.players?.[savedSeat]?.uid === currentUid) {
            await update(ref(db, `rooms/${savedCode}/players/${savedSeat}`), { connected: true });
            enterRoom(savedCode, savedSeat);
            return;
        }
    } catch (err) {
        console.error("Auto-rejoin failed", err);
    }
    sessionStorage.removeItem("ttt-room");
})();
