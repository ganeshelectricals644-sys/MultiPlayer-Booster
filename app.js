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
let roomId = "", isHost = false, clickCooldown = false;
let audioCtx = null;
const MAX_ROUNDS = 10;
const POINTS_TIERS = [100, 50, 25, 15, 15, 10, 10, 10]; 

const screens = {
    login: document.getElementById('login-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    score: document.getElementById('score-screen')
};

// HTML Elements
const joinBtn = document.getElementById('join-btn');
const readyBtn = document.getElementById('ready-btn');
const startGameBtn = document.getElementById('start-game-btn');
const nextRoundBtn = document.getElementById('next-round-btn');
const triggerBoostBtn = document.getElementById('trigger-boost-btn');
const emojiBar = document.getElementById('emoji-bar');
const opponentsContainer = document.getElementById('opponents-container');
const handContainer = document.getElementById('hand-container');
const turnIndicator = document.getElementById('turn-indicator');
let lastEmojiTs = Date.now();

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
    
    if (screenName === 'game') screens.game.classList.remove('panic-mode');
}

// --- AUDIO & HAPTICS ---
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSound(type) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'pass') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        if (navigator.vibrate) navigator.vibrate(30);
    } else if (type === 'panic') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(); osc.stop(audioCtx.currentTime + 0.5);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
}

// --- 1. SETUP ---
joinBtn.addEventListener('click', async () => {
    initAudio();
    const playerName = document.getElementById('player-name').value.trim();
    let inputRoom = document.getElementById('room-code').value.trim().toUpperCase();
    if (!playerName) return alert("Please enter your name!");

    roomId = inputRoom || Math.random().toString(36).substring(2, 6).toUpperCase();
    if (!inputRoom) {
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
    readyBtn.innerText = "Waiting...";
});

// --- 2. HOST CONTROLS (DEALING) ---
async function dealRound(targetRound) {
    const roomData = (await get(ref(db, `rooms/${roomId}`))).val();
    let allChits = roomData.chitPool || [];
    let playerIds = Object.keys(roomData.players).sort();
    
    if (allChits.length === 0) {
        playerIds.forEach(id => {
            if (roomData.players[id].chits) allChits.push(...roomData.players[id].chits);
        });
        await set(ref(db, `rooms/${roomId}/chitPool`), allChits);
    }
    
    let deckToDeal = [...allChits];
    for (let i = deckToDeal.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckToDeal[i], deckToDeal[j]] = [deckToDeal[j], deckToDeal[i]];
    }
    
    let hands = {};
    playerIds.forEach(id => hands[id] = [deckToDeal.pop(), deckToDeal.pop(), deckToDeal.pop()]);
    
    // Completely clear old boostOrder and Emojis
    await update(ref(db, `rooms/${roomId}`), {
        gameState: 'passing',
        hands: hands,
        currentTurn: playerIds[0],
        boostOrder: null, 
        emojiEvent: null,
        roundNumber: targetRound
    });
}

startGameBtn.addEventListener('click', () => dealRound(1));
nextRoundBtn.addEventListener('click', async () => {
    const currentRound = (await get(ref(db, `rooms/${roomId}`))).val().roundNumber || 1;
    if (currentRound >= MAX_ROUNDS) {
        let resetUpdates = {};
        const players = (await get(ref(db, `rooms/${roomId}/players`))).val();
        Object.keys(players).forEach(id => {
            resetUpdates[`rooms/${roomId}/players/${id}/status`] = "waiting";
            resetUpdates[`rooms/${roomId}/players/${id}/totalScore`] = 0;
        });
        resetUpdates[`rooms/${roomId}/gameState`] = "lobby";
        resetUpdates[`rooms/${roomId}/chitPool`] = null; 
        await update(ref(db), resetUpdates);
    } else {
        dealRound(currentRound + 1);
    }
});

// --- 3. EMOJI EVENT LISTENER ---
document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        await set(ref(db, `rooms/${roomId}/emojiEvent`), { emoji: btn.innerText, ts: Date.now() });
    });
});

// --- 4. THE INITIATOR ---
triggerBoostBtn.addEventListener('click', async () => {
    playSound('panic');
    let updates = {};
    updates[`rooms/${roomId}/gameState`] = 'reacting';
    // Initiator locks in 1st place!
    updates[`rooms/${roomId}/boostOrder/${playerId}`] = Date.now(); 
    await update(ref(db), updates);
    triggerBoostBtn.classList.add('hidden');
});

// --- 5. MAIN GAME LOOP ---
function listenToRoomUpdates() {
    onValue(ref(db, `rooms/${roomId}`), async (snapshot) => {
        const data = snapshot.val();
        if (!data) return; 
        const currentState = data.gameState || 'lobby';
        const players = data.players || {};
        const playerIds = Object.keys(players);
        
        // Spawn Floating Emojis
        if (data.emojiEvent && data.emojiEvent.ts > lastEmojiTs) {
            lastEmojiTs = data.emojiEvent.ts;
            const floater = document.createElement('div');
            floater.className = 'floating-emoji';
            floater.innerText = data.emojiEvent.emoji;
            document.body.appendChild(floater);
            setTimeout(() => floater.remove(), 2000);
        }
        
        let leaderId = playerIds.length > 0 ? playerIds.reduce((a, b) => (players[a].totalScore > players[b].totalScore) ? a : b) : null;

        // PHASE 1: LOBBY
        if (currentState === 'lobby') {
            showScreen('lobby');
            const listEl = document.getElementById('player-list');
            listEl.innerHTML = ""; 
            let allReady = true;
            
            for (const [id, player] of Object.entries(players)) {
                const li = document.createElement('li');
                li.innerText = `${player.name} - ${player.status}`;
                if (player.status === 'ready') li.innerText += " ✅";
                listEl.appendChild(li);
                if (player.status !== 'ready') allReady = false;
            }
            readyBtn.disabled = false; readyBtn.innerText = "I'm Ready!";
            if (isHost && allReady && playerIds.length >= 2) startGameBtn.classList.remove('hidden');
        }
        
        // PHASE 2: PASSING CARDS
        if (currentState === 'passing') {
            showScreen('game');
            emojiBar.classList.add('hidden');
            document.getElementById('round-info').innerText = `Round ${data.roundNumber || 1} of ${MAX_ROUNDS}`;
            
            const myHand = data.hands ? (data.hands[playerId] || []) : [];
            const isMyTurn = (data.currentTurn === playerId);
            
            // RADIAL MATH: Plot opponents around the core
            opponentsContainer.innerHTML = "";
            let oppIndex = 0;
            const totalOpponents = Math.max(1, playerIds.length - 1);
            const radius = 130; 
            
            for (const [id, player] of Object.entries(players)) {
                if (id !== playerId) {
                    const angle = (oppIndex / totalOpponents) * 2 * Math.PI - (Math.PI / 2);
                    const x = Math.cos(angle) * radius;
                    const y = Math.sin(angle) * radius;
                    
                    const badge = document.createElement('div');
                    badge.className = 'opponent-badge';
                    badge.style.transform = `translate(${x}px, ${y}px)`;
                    if (data.currentTurn === id) badge.style.backgroundColor = '#ff4d6d'; 
                    badge.innerText = `${id === leaderId && player.totalScore > 0 ? '👑 ' : ''}${player.name}: ${data.hands[id]?.length || 0}`;
                    opponentsContainer.appendChild(badge);
                    oppIndex++;
                }
            }
            
            turnIndicator.innerText = isMyTurn ? "Your Turn! Pass a card." : `Waiting for ${players[data.currentTurn]?.name}...`;
            
            handContainer.innerHTML = ""; 
            myHand.forEach((chit, index) => {
                const chitDiv = document.createElement('div');
                chitDiv.className = 'chit';
                if (!isMyTurn) chitDiv.classList.add('disabled');
                chitDiv.innerText = chit;
                
                chitDiv.addEventListener('click', async () => {
                    if (!isMyTurn || clickCooldown) return; 
                    clickCooldown = true;
                    playSound('pass');
                    
                    let newMyHand = [...myHand];
                    newMyHand.splice(index, 1);
                    let myIndex = playerIds.sort().indexOf(playerId);
                    let nextId = playerIds.sort()[(myIndex + 1) % playerIds.length];
                    let nextHand = [...(data.hands[nextId] || []), chit];
                    
                    let updates = {};
                    updates[`rooms/${roomId}/hands/${playerId}`] = newMyHand;
                    updates[`rooms/${roomId}/hands/${nextId}`] = nextHand;
                    updates[`rooms/${roomId}/currentTurn`] = nextId; 
                    await update(ref(db), updates);
                    setTimeout(() => { clickCooldown = false; }, 300);
                });
                handContainer.appendChild(chitDiv);
            });
            
            // BUG FIX: Show ONLY Trigger button if matched
            if (myHand.length === 3 && myHand[0] === myHand[1] && myHand[1] === myHand[2]) {
                triggerBoostBtn.classList.remove('hidden');
            } else {
                triggerBoostBtn.classList.add('hidden');
            }
        }

        // PHASE 3: REACTING
        if (currentState === 'reacting') {
            screens.game.classList.add('panic-mode');
            opponentsContainer.innerHTML = "";
            triggerBoostBtn.classList.add('hidden');
            emojiBar.classList.remove('hidden');
            turnIndicator.innerText = "🚨 SOMEONE BOOSTED! 🚨";
            turnIndicator.style.color = "white";
            
            const boostOrder = data.boostOrder || {};
            
            if (boostOrder[playerId]) {
                handContainer.innerHTML = "<h2 style='color:#2dc653'>Hand slammed! Waiting...</h2>";
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

            // BUG FIX: Exact player-count score slicing
            if (isHost && Object.keys(boostOrder).length === playerIds.length) {
                const sortedPlayers = Object.entries(boostOrder).sort((a, b) => a[1] - b[1]);
                const validTiers = POINTS_TIERS.slice(0, playerIds.length); // Slices points array to match room size
                
                let scoreUpdates = {};
                scoreUpdates[`rooms/${roomId}/gameState`] = 'scoring';
                
                sortedPlayers.forEach((pair, index) => {
                    const pId = pair[0];
                    const pointsEarned = validTiers[index] || 10; 
                    const currentScore = players[pId].totalScore || 0;
                    scoreUpdates[`rooms/${roomId}/players/${pId}/totalScore`] = currentScore + pointsEarned;
                    scoreUpdates[`rooms/${roomId}/players/${pId}/lastRoundPoints`] = pointsEarned;
                });
                await update(ref(db), scoreUpdates);
            }
        }

        // PHASE 4: SCOREBOARD
        if (currentState === 'scoring') {
            showScreen('score');
            turnIndicator.style.color = "#ff4d6d"; // Reset color
            const listEl = document.getElementById('leaderboard-list');
            listEl.innerHTML = "";
            
            const isFinale = (data.roundNumber >= MAX_ROUNDS);
            document.getElementById('score-title').innerText = isFinale ? "🏆 TOURNAMENT WINNER 🏆" : `Round ${data.roundNumber} Results`;
            
            const sortedByScore = Object.entries(players).sort((a, b) => (b[1].totalScore || 0) - (a[1].totalScore || 0));
            sortedByScore.forEach((pair, index) => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${index === 0 && isFinale ? "👑 " : ""}${pair[1].name}</span> 
                                <span><b>Total: ${pair[1].totalScore || 0}</b> <span style="color:#c9184a;">(+${pair[1].lastRoundPoints || 0})</span></span>`;
                listEl.appendChild(li);
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
