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
let clickCooldown = false; // Prevents spam clicking
const MAX_ROUNDS = 10;
const POINTS_TIERS = [100, 50, 25, 15, 15, 10, 10, 10]; // 1st to 8th place

const screens = {
    login: document.getElementById('login-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    score: document.getElementById('score-screen')
};

const joinBtn = document.getElementById('join-btn');
const readyBtn = document.getElementById('ready-btn');
const startGameBtn = document.getElementById('start-game-btn');
const nextRoundBtn = document.getElementById('next-round-btn');
const boostBtn = document.getElementById('boost-btn');

const playerListEl = document.getElementById('player-list');
const handContainer = document.getElementById('hand-container');
const opponentsContainer = document.getElementById('opponents-container');
const turnIndicator = document.getElementById('turn-indicator');
const leaderboardList = document.getElementById('leaderboard-list');
const roundInfo = document.getElementById('round-info');
const scoreTitle = document.getElementById('score-title');

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
}

// --- 1. SETUP ---
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
    await set(playerRef, { name: playerName, status: 'joining...', totalScore: 0 });
    onDisconnect(playerRef).remove();

    showScreen('lobby');
    document.getElementById('display-room-code').innerText = roomId;
    listenToRoomUpdates();
});

readyBtn.addEventListener('click', async () => {
    const chits = [
        document.getElementById('chit-1').value.trim(),
        document.getElementById('chit-2').value.trim(),
        document.getElementById('chit-3').value.trim()
    ];
    if (chits.includes("")) return alert("Please fill in all 3 chits!");

    await update(ref(db, `rooms/${roomId}/players/${playerId}`), { status: 'ready', chits });
    readyBtn.disabled = true;
    readyBtn.innerText = "Waiting for others...";
});

// --- 2. HOST CONTROLS (DEALING LOGIC) ---
async function dealRound(targetRound) {
    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const roomData = snapshot.val();
    let allChits = roomData.chitPool || [];
    let playerIds = Object.keys(roomData.players).sort();
    
    // First time generating the permanent deck
    if (allChits.length === 0) {
        playerIds.forEach(id => {
            if (roomData.players[id].chits) allChits.push(...roomData.players[id].chits);
        });
        await set(ref(db, `rooms/${roomId}/chitPool`), allChits);
    }
    
    // Shuffle Array
    let deckToDeal = [...allChits];
    for (let i = deckToDeal.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckToDeal[i], deckToDeal[j]] = [deckToDeal[j], deckToDeal[i]];
    }
    
    let hands = {};
    playerIds.forEach(id => {
        hands[id] = [deckToDeal.pop(), deckToDeal.pop(), deckToDeal.pop()];
    });
    
    await update(ref(db, `rooms/${roomId}`), {
        gameState: 'passing',
        hands: hands,
        currentTurn: playerIds[0],
        boostOrder: null, 
        roundNumber: targetRound
    });
}

startGameBtn.addEventListener('click', () => dealRound(1));

nextRoundBtn.addEventListener('click', async () => {
    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const currentRound = snapshot.val().roundNumber || 1;
    
    if (currentRound >= MAX_ROUNDS) {
        // RESET ENTIRE TOURNAMENT
        let resetUpdates = {};
        Object.keys(snapshot.val().players).forEach(id => {
            resetUpdates[`rooms/${roomId}/players/${id}/status`] = "waiting";
            resetUpdates[`rooms/${roomId}/players/${id}/totalScore`] = 0;
            resetUpdates[`rooms/${roomId}/players/${id}/lastRoundPoints`] = 0;
        });
        resetUpdates[`rooms/${roomId}/gameState`] = "lobby";
        resetUpdates[`rooms/${roomId}/chitPool`] = null; // Clear old deck
        await update(ref(db), resetUpdates);
    } else {
        // NEXT ROUND
        dealRound(currentRound + 1);
    }
});

// --- 3. TRIGGER BOOST ---
boostBtn.addEventListener('click', async () => {
    let updates = {};
    updates[`rooms/${roomId}/gameState`] = 'reacting';
    updates[`rooms/${roomId}/boostOrder/${playerId}`] = Date.now();
    await update(ref(db), updates);
    boostBtn.classList.add('hidden');
});

// --- 4. MAIN GAME LOOP ---
function listenToRoomUpdates() {
    onValue(ref(db, `rooms/${roomId}`), async (snapshot) => {
        const data = snapshot.val();
        if (!data) return; 
        const currentState = data.gameState || 'lobby';
        const players = data.players || {};
        const playerIds = Object.keys(players);
        
        // Calculate Leader for Crown Emoji
        let leaderId = playerIds.length > 0 ? playerIds.reduce((a, b) => (players[a].totalScore > players[b].totalScore) ? a : b) : null;

        // PHASE 1: LOBBY
        if (currentState === 'lobby') {
            showScreen('lobby');
            playerListEl.innerHTML = ""; 
            let allReady = true;
            
            for (const [id, player] of Object.entries(players)) {
                const li = document.createElement('li');
                li.innerText = `${player.name} - ${player.status}`;
                if (player.status === 'ready') li.innerText += " ✅";
                playerListEl.appendChild(li);
                if (player.status !== 'ready') allReady = false;
            }

            readyBtn.disabled = false;
            readyBtn.innerText = "I'm Ready!";
            
            if (isHost && allReady && playerIds.length >= 2) startGameBtn.classList.remove('hidden');
            else startGameBtn.classList.add('hidden');
        }
        
        // PHASE 2: PASSING CARDS
        if (currentState === 'passing') {
            showScreen('game');
            roundInfo.innerText = `Tournament Round ${data.roundNumber || 1} of ${MAX_ROUNDS}`;
            const myHand = data.hands ? (data.hands[playerId] || []) : [];
            const isMyTurn = (data.currentTurn === playerId);
            
            // Render Opponents Bar with Crown
            opponentsContainer.innerHTML = "";
            for (const [id, player] of Object.entries(players)) {
                if (id !== playerId) {
                    const badge = document.createElement('div');
                    badge.className = 'opponent-badge';
                    if (data.currentTurn === id) badge.style.backgroundColor = '#ff4d6d'; 
                    let nameText = id === leaderId && player.totalScore > 0 ? `👑 ${player.name}` : player.name;
                    badge.innerText = `${nameText}: ${data.hands[id]?.length || 0} 🃏`;
                    opponentsContainer.appendChild(badge);
                }
            }
            
            turnIndicator.innerText = isMyTurn ? "Your Turn! Pass a card." : `Waiting for ${players[data.currentTurn]?.name}...`;
            
            // Render Cards with Anti-Spam
            handContainer.innerHTML = ""; 
            myHand.forEach((chit, index) => {
                const chitDiv = document.createElement('div');
                chitDiv.className = 'chit';
                if (!isMyTurn) chitDiv.classList.add('disabled');
                chitDiv.innerText = chit;
                
                chitDiv.addEventListener('click', async () => {
                    if (!isMyTurn || clickCooldown) return; 
                    
                    clickCooldown = true;
                    chitDiv.classList.add('cooldown'); // Visual feedback
                    
                    let newMyHand = [...myHand];
                    newMyHand.splice(index, 1);
                    
                    let myIndex = playerIds.sort().indexOf(playerId);
                    let nextPlayerId = playerIds.sort()[(myIndex + 1) % playerIds.length];
                    let nextPlayerHand = [...(data.hands[nextPlayerId] || []), chit];
                    
                    let updates = {};
                    updates[`rooms/${roomId}/hands/${playerId}`] = newMyHand;
                    updates[`rooms/${roomId}/hands/${nextPlayerId}`] = nextPlayerHand;
                    updates[`rooms/${roomId}/currentTurn`] = nextPlayerId; 
                    await update(ref(db), updates);
                    
                    setTimeout(() => { clickCooldown = false; }, 300); // 300ms Cooldown
                });
                handContainer.appendChild(chitDiv);
            });
            
            // Win Condition
            if (myHand.length === 3 && myHand[0] === myHand[1] && myHand[1] === myHand[2]) {
                boostBtn.classList.remove('hidden');
            } else {
                boostBtn.classList.add('hidden');
            }
        }

        // PHASE 3: REACTING
        if (currentState === 'reacting') {
            showScreen('game');
            opponentsContainer.innerHTML = "";
            boostBtn.classList.add('hidden');
            turnIndicator.innerText = "🚨 SOMEONE BOOSTED! 🚨";
            
            const boostOrder = data.boostOrder || {};
            if (boostOrder[playerId]) {
                handContainer.innerHTML = "<h2 style='color:#c9184a'>Hand slammed! Waiting for others...</h2>";
            } else {
                handContainer.innerHTML = "";
                const panicBtn = document.createElement('div');
                panicBtn.className = 'panic-btn';
                panicBtn.innerText = "BOOST!";
                
                panicBtn.addEventListener('click', async () => {
                    await set(ref(db, `rooms/${roomId}/boostOrder/${playerId}`), Date.now());
                });
                handContainer.appendChild(panicBtn);
            }

            // Host Scores round when all players click
            if (isHost && Object.keys(boostOrder).length === playerIds.length) {
                const sortedPlayers = Object.entries(boostOrder).sort((a, b) => a[1] - b[1]);
                let scoreUpdates = {};
                scoreUpdates[`rooms/${roomId}/gameState`] = 'scoring';
                
                sortedPlayers.forEach((pair, index) => {
                    const pId = pair[0];
                    const pointsEarned = POINTS_TIERS[index] || 10; // Tiered Distribution
                    const currentScore = players[pId].totalScore || 0;
                    scoreUpdates[`rooms/${roomId}/players/${pId}/totalScore`] = currentScore + pointsEarned;
                    scoreUpdates[`rooms/${roomId}/players/${pId}/lastRoundPoints`] = pointsEarned;
                });
                await update(ref(db), scoreUpdates);
            }
        }

        // PHASE 4: SCOREBOARD & FINALE
        if (currentState === 'scoring') {
            showScreen('score');
            leaderboardList.innerHTML = "";
            
            const isFinale = (data.roundNumber >= MAX_ROUNDS);
            scoreTitle.innerText = isFinale ? "🏆 TOURNAMENT WINNER 🏆" : `Round ${data.roundNumber} Results`;
            
            const sortedByScore = Object.entries(players).sort((a, b) => (b[1].totalScore || 0) - (a[1].totalScore || 0));
            
            sortedByScore.forEach((pair, index) => {
                const player = pair[1];
                const li = document.createElement('li');
                let rankVisual = index === 0 && isFinale ? "👑 " : "";
                
                li.innerHTML = `<span>${rankVisual}${player.name}</span> 
                                <span><b>Total: ${player.totalScore || 0}</b> 
                                <span style="color:#c9184a; font-size:14px;">(+${player.lastRoundPoints || 0})</span></span>`;
                
                // Highlight winner in finale
                if (isFinale && index === 0) {
                    li.style.backgroundColor = "#ff758f";
                    li.style.color = "white";
                    li.style.transform = "scale(1.05)";
                }
                
                leaderboardList.appendChild(li);
            });

            if (isHost) {
                nextRoundBtn.classList.remove('hidden');
                nextRoundBtn.innerText = isFinale ? "End Tournament & Start Fresh" : `Start Round ${data.roundNumber + 1}`;
            } else {
                nextRoundBtn.classList.add('hidden');
            }
        }
    });
}
