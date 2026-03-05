const express = require("express");
const app = express();

const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.resolve("")));

app.get("/", (req, res) => {
    return res.sendFile("index.html");
});

// Game state - support 2 players only
let players = {};
let socketToPlayer = {};
let waitingPlayer = null;
let gameActive = false;

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("searchPlayer", (data) => {
        const username = typeof data === 'object' ? data.username : data;
        const playerId = typeof data === 'object' && data.playerId ? data.playerId : username;

        // Prevent new players from joining if a game is active
        if (gameActive) {
            // Check if this is a reconnecting player
            const player = players[playerId];

            if (player && player.disconnected) {
                console.log(`${username} is reconnecting...`);
                
                // Clear timeout if exists
                if (player.timeout) clearTimeout(player.timeout);

                // Update player data with new socket ID
                // Remove old socket mapping if it exists (unlikely if disconnected)
                // But we map new socket
                player.socketId = socket.id;
                player.disconnected = false;
                socketToPlayer[socket.id] = playerId;

                const opponentId = Object.keys(players).find(id => id !== playerId);
                const opponent = players[opponentId];

                socket.emit("gameStart", {
                    opponent: opponent,
                    player: player,
                    isFirstPlayer: player.isFirstPlayer
                });

                if (opponent && opponent.socketId) {
                    io.to(opponent.socketId).emit("playerReconnected", { 
                        id: playerId,
                        username: username 
                    });
                }

                return;
            }

            socket.emit("serverBusy", { message: "Server is currently busy, please try again later." });
            console.log(`Busy: ${username} (${socket.id}) attempted to join while game is active.`);
            return;
        }

        console.log(`${username} is searching for a player`);
        
        // Store player info
        players[playerId] = {
            id: playerId,
            socketId: socket.id,
            username: username,
            x: 100,
            y: 100,
            ready: false
        };
        socketToPlayer[socket.id] = playerId;

        if (waitingPlayer && waitingPlayer.playerId !== playerId) {
            // Match found - 2 players!
            const player1 = waitingPlayer.playerId;
            const player2 = playerId;
            
            // Store isFirstPlayer for reconnection handling
            players[player1].isFirstPlayer = true;
            players[player2].isFirstPlayer = false;

            // Start the game for both players
            io.to(players[player1].socketId).emit("gameStart", {
                opponent: players[player2],
                player: players[player1],
                isFirstPlayer: true
            });
            
            io.to(players[player2].socketId).emit("gameStart", {
                opponent: players[player1],
                player: players[player2],
                isFirstPlayer: false
            });

            // Initialize positions - 2 players
            players[player1].x = 100;
            players[player1].y = 300;
            players[player1].ready = true;
            
            players[player2].x = 700;
            players[player2].y = 300;
            players[player2].ready = true;

            gameActive = true;
            waitingPlayer = null;
            
            console.log(`Game started between ${players[player1].username} and ${players[player2].username}`);
        } else {
            // No player waiting, this player waits
            waitingPlayer = { socketId: socket.id, playerId: playerId };
            socket.emit("waiting", { message: "Waiting for another player..." });
        }
    });

    socket.on("playerMove", (data) => {
        const playerId = socketToPlayer[socket.id];
        if (playerId && players[playerId] && gameActive) {
            players[playerId].x = data.x;
            players[playerId].y = data.y;
            
            // Broadcast position to all other players
            socket.broadcast.emit("playerMoved", {
                id: playerId,
                x: data.x,
                y: data.y
            });

            // Make disconnected players follow
            Object.keys(players).forEach((id) => {
                if (id !== playerId && players[id].disconnected) {
                    players[id].x = data.x - 50;
                    players[id].y = data.y - 50;
                    
                    io.emit("playerMoved", {
                        id: id,
                        x: players[id].x,
                        y: players[id].y
                    });
                }
            });
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        const playerId = socketToPlayer[socket.id];
        
        if (waitingPlayer && waitingPlayer.socketId === socket.id) {
            waitingPlayer = null;
        }
        
        if (playerId && players[playerId]) {
            const username = players[playerId].username;
            
            if (gameActive) {
                // Mark as disconnected but keep in game to follow
                players[playerId].disconnected = true;
                // Remove socket mapping
                delete socketToPlayer[socket.id];
                
                console.log(`${username} disconnected. Character will now follow remaining players.`);

                // Remove player permanently if they don't reconnect in 30s
                players[playerId].timeout = setTimeout(() => {
                    if (players[playerId]) {
                        delete players[playerId];
                        if (Object.keys(players).length === 0) {
                            gameActive = false;
                            waitingPlayer = null;
                        }
                    }
                }, 30000);
                
                // Reset game only if all players are disconnected
                const activeCount = Object.values(players).filter(p => !p.disconnected).length;
                if (activeCount === 0) {
                    players = {};
                    socketToPlayer = {};
                    gameActive = false;
                    waitingPlayer = null;
                    console.log("All players disconnected. Game reset.");
                }
            } else {
                delete players[playerId];
                delete socketToPlayer[socket.id];
                
                // Notify other player
                io.emit("playerDisconnected", { 
                    id: playerId, 
                    message: `${username} disconnected` 
                });
                
                // Reset game if less than 2 players
                const activePlayers = Object.keys(players).filter(id => players[id] && players[id].ready);
                if (activePlayers.length < 2) {
                    gameActive = false;
                    waitingPlayer = null;
                }
            }
        }
    });
});

server.listen(3000, () => {
    console.log("Server is running on port 3000");
});
