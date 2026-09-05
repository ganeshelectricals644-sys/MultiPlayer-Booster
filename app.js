import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, onDisconnect, get, serverTimestamp } 
from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

// --- FIREBASE CONFIGURATION ---
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

// --- GAME VARIABLES ---
let playerId = `player_${Math.random().toString(36).substring(2, 9)}`; 
let roomId = "";
let isHost = false;
let clickCooldown = false; 
let audioCtx = null;
let lastEmojiTs = Date.now();
const MAX_ROUNDS = 10;

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
const triggerBoostBtn = document.getElementById('trigger-boost-btn');
const emojiBar = document.getElementById('emoji-bar');
const opponentsContainer = document.getElementById('opponents-container');
const handContainer = document.getElementById('hand-container');
const turnIndicator = document.getElementById('turn-indicator');
const roundInfo = document.getElementById('round-info');

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
    if (screenName === 'game') screens.game.classList.remove('panic-mode');
}

// --- AUDIO & HAPTICS SETUP ---
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSound(type) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'pass') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
        if (navigator.vibrate) navigator.vibrate(30);
    } else if (type === 'panic') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(); osc.stop(audioCtx.currentTime + 0.5);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
}

// --- 1. JOIN / CREATE ROOM ---
joinBtn.addEventListener('click', async () => {
    initAudio(); 
    const playerName = document.getElementById('player-name').value.trim();
    let inputRoom = document.getElementById('room-code').value.trim().toUpperCase();
    
    if (!playerName) return alert("Please enter your name!");
    if (inputRoom) { roomId = inputRoom; } 
    else {
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

// --- 2. SUBMIT CHITS ---
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

// --- 3. HOST CONTROLS (DEALING) ---
async function dealRound(targetRound) {
    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const roomData = snapshot.val();
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
    
    await update(ref(db, `rooms/${roomId}`), {
        gameState: 'passing', hands: hands, currentTurn: playerIds[0],
        boostOrder: null, emojiEvent: null, roundNumber: targetRound
    });
}

startGameBtn.addEventListener('click', () => dealRound(1));

nextRoundBtn.addEventListener('click', async () => {
    const snapshot = await get(ref(db, `rooms/${roomId}`));
    const currentRound = snapshot.val().roundNumber || 1;
    
    if (currentRound >= MAX_ROUNDS) {
        let resetUpdates = {};
        const players = snapshot.val().players;
        Object.keys(players).forEach(id => {
            resetUpdates[`rooms/${roomId}/players/${id}/status`] = "waiting";
            resetUpdates[`rooms/${roomId}/players/${id}/totalScore`] = 0;
            resetUpdates[`rooms/${roomId}/players/${id}/lastRoundPoints`] = 0;
        });
        resetUpdates[`rooms/${roomId}/gameState`] = "lobby";
        resetUpdates[`rooms/${roomId}/chitPool`] = null; 
        await update(ref(db), resetUpdates);
    } else { dealRound(currentRound + 1); }
});

// --- 4. FLOATING EMOJIS ---
document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        await set(ref(db, `rooms/${roomId}/emojiEvent`), { emoji: btn.innerText, ts: Date.now() });
    });
});

// --- 5. THE INITIATOR ---
triggerBoostBtn.addEventListener('click', async () => {
    playSound('panic');
    let updates = {};
    updates[`rooms/${roomId}/gameState`] = 'reacting';
    updates[`rooms/${roomId}/boostOrder/${playerId}`] = serverTimestamp(); 
    await update(ref(db), updates);
    triggerBoostBtn.classList.add('hidden');
});

// --- 6. MAIN GAME LOOP ---
function listenToRoomUpdates() {
    onValue(ref(db, `rooms/${roomId}`), async (snapshot) => {
        const data = snapshot.val();
        if (!data) return; 
        const currentState = data.gameState || 'lobby';
        const players = data.players || {};
        const playerIds = Object.keys(players);
        
        if (data.emojiEvent && data.emojiEvent.ts > lastEmojiTs) {
            lastEmojiTs = data.emojiEvent.ts;
            const floater = document.createElement('div');
            floater.className = 'floating-emoji';
            floater.innerText = data.emojiEvent.emoji;
            document.body.appendChild(floater);
            setTimeout(() => floater.remove(), 2000);
        }
        
        let leaderId = playerIds.length > 0 ? playerIds.reduce((a, b) => (players[a].totalScore > players[b].totalScore) ? a : b) : null;

        // --- PHASE 1: LOBBY ---
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
            else startGameBtn.classList.add('hidden');
        }
        
        // --- PHASE 2: PASSING CARDS ---
        if (currentState === 'passing') {
            showScreen('game');
            emojiBar.classList.add('hidden');
            roundInfo.innerText = `Tournament Round ${data.roundNumber || 1} of ${MAX_ROUNDS}`;
            
            const myHand = data.hands ? (data.hands[playerId] || []) : [];
            const isMyTurn = (data.currentTurn === playerId);
            
            opponentsContainer.innerHTML = "";
            let oppIndex = 0;
            const totalOpponents = Math.max(1, playerIds.length - 1);
            const radius = 135; 
            
            for (const [id, player] of Object.entries(players)) {
                if (id !== playerId) {
                    const angle = (oppIndex / totalOpponents) * 2 * Math.PI - (Math.PI / 2);
                    const x = Math.cos(angle) * radius - 40; 
                    const y = Math.sin(angle) * radius - 30; 
                    
                    const badge = document.createElement('div');
                    badge.className = 'opponent-badge';
                    badge.style.transform = `translate(${x}px, ${y}px)`;
                    if (data.currentTurn === id) badge.style.backgroundColor = '#ff4d6d'; 
                    
                    const nameEl = document.createElement('div');
                    nameEl.style.marginBottom = '6px';
                    nameEl.style.color = data.currentTurn === id ? 'white' : '#4a4e69';
                    nameEl.innerText = id === leaderId && player.totalScore > 0 ? `👑 ${player.name}` : player.name;
                    badge.appendChild(nameEl);

                    const tray = document.createElement('div');
                    tray.style.display = 'flex';
                    tray.style.justifyContent = 'center';
                    const handSize = data.hands[id]?.length || 0;
                    for(let i = 0; i < handSize; i++) {
                        const cardBack = document.createElement('div');
                        cardBack.className = 'mini-card';
                        tray.appendChild(cardBack);
                    }
                    badge.appendChild(tray);
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
                    if (!isMyTurn) {
                        chitDiv.classList.add('shake-error');
                        setTimeout(() => chitDiv.classList.remove('shake-error'), 300);
                        return;
                    }
                    if (clickCooldown) return; 
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
            
            if (myHand.length === 3 && myHand[0] === myHand[1] && myHand[1] === myHand[2]) {
                triggerBoostBtn.classList.remove('hidden');
            } else { triggerBoostBtn.classList.add('hidden'); }
        }

        // --- PHASE 3: REACTING (THE HAND PILE) ---
        if (currentState === 'reacting') {
            screens.game.classList.add('panic-mode');
            triggerBoostBtn.classList.add('hidden');
            emojiBar.classList.remove('hidden');
            turnIndicator.innerText = "🚨 SOMEONE SLAPPED! 🚨";
            turnIndicator.style.color = "white";

            // Maintain the avatars sitting around the table (but remove their cards)
            document.querySelectorAll('.mini-card').forEach(c => c.remove());
            
            handContainer.innerHTML = "";
            
            // Create the central Pile
            const pile = document.createElement('div');
            pile.id = 'pile-container';
            handContainer.appendChild(pile);

            const boostOrder = data.boostOrder || {};
            const sortedSlaps = Object.entries(boostOrder).sort((a, b) => a[1] - b[1]);

            // Draw Hands in order!
            sortedSlaps.forEach((pair, index) => {
                const pId = pair[0];
                const pName = players[pId]?.name || "Player";
                const ts = pair[1]; // Timestamp

                const handDiv = document.createElement('div');
                handDiv.className = 'slap-hand';
                handDiv.style.zIndex = index + 1; // Stack them properly!
                
                // Deterministic rotation based on exact click time so they look messy
                const rotation = (ts % 60) - 30; // Between -30 and +30 degrees

                handDiv.innerHTML = `
                    <div class="slap-inner" style="transform: rotate(${rotation}deg);">
                        ✋
                        <div class="slap-name">${pName}</div>
                    </div>`;
                pile.appendChild(handDiv);
            });

            // Draw Button if local player hasn't clicked
            if (!boostOrder[playerId]) {
                const slapBtn = document.createElement('div');
                slapBtn.className = 'panic-btn';
                slapBtn.innerText = "SLAP!";
                slapBtn.addEventListener('click', async () => {
                    await set(ref(db, `rooms/${roomId}/boostOrder/${playerId}`), serverTimestamp());
                });
                handContainer.appendChild(slapBtn);
            } else {
                const waitText = document.createElement('h3');
                waitText.innerText = "Hand slammed! Waiting for slowpokes...";
                waitText.style.color = "#2dc653";
                waitText.style.position = "absolute";
                waitText.style.bottom = "-80px";
                handContainer.appendChild(waitText);
            }

            // HOST LOGIC: SURVIVAL SCORING!
            if (isHost && Object.keys(boostOrder).length === playerIds.length) {
                let scoreUpdates = {};
                scoreUpdates[`rooms/${roomId}/gameState`] = 'scoring';
                
                sortedSlaps.forEach((pair, index) => {
                    const pId = pair[0];
                    
                    let pointsEarned = 20; // Middle Survivors
                    if (index === 0) pointsEarned = 50; // The Initiator
                    if (index === sortedSlaps.length - 1) pointsEarned = 0; // The Slowest Loser!
                    
                    const currentScore = players[pId].totalScore || 0;
                    scoreUpdates[`rooms/${roomId}/players/${pId}/totalScore`] = currentScore + pointsEarned;
                    scoreUpdates[`rooms/${roomId}/players/${pId}/lastRoundPoints`] = pointsEarned;
                });
                await update(ref(db), scoreUpdates);
            }
        }

        // --- PHASE 4: SCOREBOARD ---
        if (currentState === 'scoring') {
            showScreen('score');
            turnIndicator.style.color = "#ff4d6d"; 
            const listEl = document.getElementById('leaderboard-list');
            listEl.innerHTML = "";
            
            const isFinale = (data.roundNumber >= MAX_ROUNDS);
            document.getElementById('score-title').innerText = isFinale ? "🏆 TOURNAMENT WINNER 🏆" : `Round ${data.roundNumber} Results`;
            
            const sortedByScore = Object.entries(players).sort((a, b) => (b[1].totalScore || 0) - (a[1].totalScore || 0));
            sortedByScore.forEach((pair, index) => {
                const pId = pair[0];
                const li = document.createElement('li');
                let rankVisual = index === 0 && isFinale ? "👑 " : "";
                
                // Color Code the points based on Survival
                let pointColor = "#c9184a"; // Default Middle (20)
                if (pair[1].lastRoundPoints === 50) pointColor = "#2dc653"; // Winner Green
                if (pair[1].lastRoundPoints === 0) pointColor = "#d90429"; // Loser Red
                
                li.innerHTML = `<span>${rankVisual}${pair[1].name}</span> 
                                <span><b>Total: ${pair[1].totalScore || 0}</b> 
                                <span style="color:${pointColor}; font-size:14px; margin-left:8px;">(+${pair[1].lastRoundPoints || 0})</span></span>`;
                
                if (isFinale && index === 0) {
                    li.style.backgroundColor = "#ff758f";
                    li.style.color = "white";
                    li.style.transform = "scale(1.05)";
                }
                listEl.appendChild(li);
            });

            if (isHost) {
                nextRoundBtn.classList.remove('hidden');
                nextRoundBtn.innerText = isFinale ? "End Tournament & Start Fresh" : `Start Round ${data.roundNumber + 1}`;
            } else { nextRoundBtn.classList.add('hidden'); }
        }
    });
}
