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
let waitingPlayer = null;
let gameActive = false;

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("searchPlayer", (username) => {
        console.log(`${username} is searching for a player`);
        
        // Store player info
        players[socket.id] = {
            id: socket.id,
            username: username,
            x: 100,
            y: 100,
            ready: false
        };

        if (waitingPlayer && waitingPlayer !== socket.id) {
            // Match found - 2 players!
            const player1 = waitingPlayer;
            const player2 = socket.id;
            
            // Start the game for both players
            io.to(player1).emit("gameStart", {
                opponent: players[player2],
                player: players[player1],
                isFirstPlayer: true
            });
            
            io.to(player2).emit("gameStart", {
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
            waitingPlayer = socket.id;
            socket.emit("waiting", { message: "Waiting for another player..." });
        }
    });

    socket.on("playerMove", (data) => {
        if (players[socket.id] && gameActive) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            
            // Broadcast position to all other players
            socket.broadcast.emit("playerMoved", {
                id: socket.id,
                x: data.x,
                y: data.y
            });
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
        }
        
        if (players[socket.id]) {
            const username = players[socket.id].username;
            delete players[socket.id];
            
            // Notify other player
            io.emit("playerDisconnected", { 
                id: socket.id, 
                message: `${username} disconnected` 
            });
            
            // Reset game if less than 2 players
            const activePlayers = Object.keys(players).filter(id => players[id] && players[id].ready);
            if (activePlayers.length < 2) {
                gameActive = false;
                waitingPlayer = null;
            }
        }
    });
});

server.listen(3000, () => {
    console.log("Server is running on port 3000");
});
