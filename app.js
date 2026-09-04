import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, onDisconnect, get } 
from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

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

let playerId = `player_${Math.random().toString(36).substring(2, 9)}`; 
let roomId = "";
let isHost = false;

const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const joinBtn = document.getElementById('join-btn');
const readyBtn = document.getElementById('ready-btn');
const startGameBtn = document.getElementById('start-game-btn');
const playerListEl = document.getElementById('player-list');
const handContainer = document.getElementById('hand-container');
const boostBtn = document.getElementById('boost-btn');
const opponentsContainer = document.getElementById('opponents-container');
const turnIndicator = document.getElementById('turn-indicator');

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

// 3. Host Starts Game
startGameBtn.addEventListener('click', async () => {
    const snapshot = await get(ref(db, `rooms/${roomId}/players`));
    const players = snapshot.val();
    
    let allChits = [];
    let playerIds = Object.keys(players).sort(); // Sorted to define the circle order
    
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
        currentTurn: playerIds[0] // Set turn to the first player in the circle
    });
});

// 4. Live Updates from Firebase
function listenToRoomUpdates() {
    const roomRef = ref(db, `rooms/${roomId}`);
    
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return; 

        const currentState = data.gameState || 'lobby';

        // LOBBY LOGIC
        if (currentState === 'lobby') {
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
        
        // GAME LOGIC
        if (currentState === 'passing' || currentState === 'reacting') {
            lobbyScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
            
            const myHand = data.hands ? (data.hands[playerId] || []) : [];
            const players = data.players || {};
            const playerIds = Object.keys(players).sort();
            const isMyTurn = (data.currentTurn === playerId);
            
            // Render Opponents Bar
            opponentsContainer.innerHTML = "";
            for (const [id, player] of Object.entries(players)) {
                if (id !== playerId) {
                    const opponentHandSize = data.hands && data.hands[id] ? data.hands[id].length : 0;
                    const badge = document.createElement('div');
                    badge.className = 'opponent-badge';
                    // Highlight if it is their turn
                    if (data.currentTurn === id) badge.style.backgroundColor = '#ff4d6d'; 
                    badge.innerText = `${player.name}: ${opponentHandSize} 🃏`;
                    opponentsContainer.appendChild(badge);
                }
            }
            
            // Update Turn Text
            if (isMyTurn) {
                turnIndicator.innerText = "Your Turn! Pass a card.";
                turnIndicator.style.color = "#ff4d6d";
            } else {
                const activePlayerName = players[data.currentTurn] ? players[data.currentTurn].name : "someone";
                turnIndicator.innerText = `Waiting for ${activePlayerName}...`;
                turnIndicator.style.color = "#4a4e69";
            }

            // Render Hand & Pass Logic
            handContainer.innerHTML = ""; 
            myHand.forEach((chit, index) => {
                const chitDiv = document.createElement('div');
                chitDiv.className = 'chit';
                if (!isMyTurn) chitDiv.classList.add('disabled');
                chitDiv.innerText = chit;
                
                // Clicking to pass
                chitDiv.addEventListener('click', async () => {
                    if (!isMyTurn) return; // Ignore clicks if it's not their turn
                    
                    // Remove card from my hand
                    let newMyHand = [...myHand];
                    newMyHand.splice(index, 1);
                    
                    // Figure out who the next player is
                    let myIndex = playerIds.indexOf(playerId);
                    let nextIndex = (myIndex + 1) % playerIds.length;
                    let nextPlayerId = playerIds[nextIndex];
                    
                    // Add card to next player's hand
                    let nextPlayerHand = [...(data.hands[nextPlayerId] || [])];
                    nextPlayerHand.push(chit);
                    
                    // Update Firebase instantly
                    let updates = {};
                    updates[`rooms/${roomId}/hands/${playerId}`] = newMyHand;
                    updates[`rooms/${roomId}/hands/${nextPlayerId}`] = nextPlayerHand;
                    updates[`rooms/${roomId}/currentTurn`] = nextPlayerId; // Pass turn
                    await update(ref(db), updates);
                });

                handContainer.appendChild(chitDiv);
            });
            
            // BOOST CONDITION: Must have EXACTLY 3 cards, and they must all match.
            // If they have 4 cards (because someone just passed to them), they have to discard first!
            if (myHand.length === 3 && myHand[0] === myHand[1] && myHand[1] === myHand[2]) {
                boostBtn.classList.remove('hidden');
            } else {
                boostBtn.classList.add('hidden');
            }
        }
    });
}
