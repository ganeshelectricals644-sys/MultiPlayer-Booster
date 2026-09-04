import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, onDisconnect, get } 
from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

// Your Firebase keys
const firebaseConfig = {
    apiKey: "AIzaSyAzKv1h2-D7wFrwmFxiE4i3OF7xC-MlDDs",
    authDomain: "booster-game-b9a1c.firebaseapp.com",
    databaseURL: "https://booster-game-b9a1c-default-rtdb.firebaseio.com",
    projectId: "booster-game-b9a1c",
    storageBucket: "booster-game-b9a1c.firebasestorage.app",
    messagingSenderId: "992968258469",
    appId: "1:992968258469:web:622a63671c753dff2c6e4c"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Game Variables
let playerId = `player_${Math.random().toString(36).substring(2, 9)}`; 
let roomId = "";
let isHost = false;

// HTML Elements
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const joinBtn = document.getElementById('join-btn');
const readyBtn = document.getElementById('ready-btn');
const startGameBtn = document.getElementById('start-game-btn');
const playerListEl = document.getElementById('player-list');
const handContainer = document.getElementById('hand-container');
const boostBtn = document.getElementById('boost-btn');

// 1. Join / Create Room
joinBtn.addEventListener('click', async () => {
    const playerName = document.getElementById('player-name').value.trim();
    let inputRoom = document.getElementById('room-code').value.trim().toUpperCase();

    if (!playerName) return alert("Please enter your name!");

    if (inputRoom) {
        roomId = inputRoom;
    } else {
        roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        isHost = true;
        await set(ref(db, `rooms/${roomId}/gameState`), 'lobby');
        await set(ref(db, `rooms/${roomId}/hostId`), playerId);
    }

    const playerRef = ref(db, `rooms/${roomId}/players/${playerId}`);
    await set(playerRef, { name: playerName, status: 'joining...' });
    onDisconnect(playerRef).remove();

    loginScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    document.getElementById('display-room-code').innerText = roomId;

    listenToRoomUpdates();
});

// 2. Submit Chits
readyBtn.addEventListener('click', async () => {
    const c1 = document.getElementById('chit-1').value.trim();
    const c2 = document.getElementById('chit-2').value.trim();
    const c3 = document.getElementById('chit-3').value.trim();

    if (!c1 || !c2 || !c3) return alert("Please fill in all 3 chits!");

    await update(ref(db, `rooms/${roomId}/players/${playerId}`), {
        status: 'ready',
        chits: [c1, c2, c3]
    });

    readyBtn.disabled = true;
    readyBtn.innerText = "Waiting for others...";
});

// 3. Host Starts Game (Shuffle & Deal)
startGameBtn.addEventListener('click', async () => {
    const snapshot = await get(ref(db, `rooms/${roomId}/players`));
    const players = snapshot.val();
    
    let allChits = [];
    let playerIds = Object.keys(players);
    
    for (let id of playerIds) {
        if (players[id].chits) {
            allChits.push(...players[id].chits);
        }
    }
    
    // Shuffle Array
    for (let i = allChits.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allChits[i], allChits[j]] = [allChits[j], allChits[i]];
    }
    
    let hands = {};
    for (let id of playerIds) {
        hands[id] = [allChits.pop(), allChits.pop(), allChits.pop()];
    }
    
    await update(ref(db, `rooms/${roomId}`), {
        gameState: 'passing',
        hands: hands,
        passBuffer: {} 
    });
});

// 4. Live Updates from Firebase
function listenToRoomUpdates() {
    const roomRef = ref(db, `rooms/${roomId}`);
    
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return; 

        if (data.gameState === 'lobby') {
            const players = data.players || {};
            playerListEl.innerHTML = ""; 
            let allReady = true;
            let playerCount = 0;

            for (const [id, player] of Object.entries(players)) {
                const li = document.createElement('li');
                li.innerText = `${player.name} - ${player.status}`;
                if(player.status === 'ready') li.innerText += " ✅";
                playerListEl.appendChild(li);
                playerCount++;
                if (player.status !== 'ready') allReady = false;
            }

            if (isHost && allReady && playerCount >= 2) { 
                startGameBtn.classList.remove('hidden');
            } else {
                startGameBtn.classList.add('hidden');
            }
        }
        
        if (data.gameState === 'passing' || data.gameState === 'reacting') {
            lobbyScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
            
            const myHand = data.hands ? data.hands[playerId] : [];
            handContainer.innerHTML = ""; 
            
            myHand.forEach((chit) => {
                const chitDiv = document.createElement('div');
                chitDiv.className = 'chit';
                chitDiv.innerText = chit;
                handContainer.appendChild(chitDiv);
            });
            
            if (myHand.length === 3 && myHand[0] === myHand[1] && myHand[1] === myHand[2]) {
                boostBtn.classList.remove('hidden');
            } else {
                boostBtn.classList.add('hidden');
            }
        }
    });
}