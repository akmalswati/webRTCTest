// server/server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

// Health check (for testing)
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

const server = http.createServer(app);

// Socket.IO signaling
const io = new Server(server, {
  cors: {
    origin: '*',          // in prod: restrict this
    methods: ['GET', 'POST']
  }
});

// roomId -> Set of socketIds
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on('join', ({ roomId, userId }) => {
    console.log(`👤 ${userId} (${socket.id}) joining room ${roomId}`);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    const participants = rooms.get(roomId);

    if (participants.size >= 2) {
      console.log(`❌ Room ${roomId} is full`);
      socket.emit('room-full', { roomId });
      return;
    }

    participants.add(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = userId;

    // Notify the new user about current room state
    socket.emit('joined-room', {
      roomId,
      userId,
      socketId: socket.id,
      existingCount: participants.size - 1
    });

    // If there is another participant, connect them
    if (participants.size === 2) {
      const [socketId1, socketId2] = Array.from(participants);

      // Decide roles: second user to join will be initiator
      const initiator = socket.id;                      // new user
      const receiver = socketId1 === initiator ? socketId2 : socketId1;

      console.log(`🔗 Room ${roomId} ready, initiator: ${initiator}, receiver: ${receiver}`);

      io.to(initiator).emit('ready', {
        peerSocketId: receiver,
        isInitiator: true
      });

      io.to(receiver).emit('ready', {
        peerSocketId: initiator,
        isInitiator: false
      });
    }
  });

  // Relay offer
  socket.on('offer', ({ sdp, to }) => {
    console.log(`📤 Offer from ${socket.id} to ${to}`);
    io.to(to).emit('offer', {
      sdp,
      from: socket.id
    });
  });

  // Relay answer
  socket.on('answer', ({ sdp, to }) => {
    console.log(`📤 Answer from ${socket.id} to ${to}`);
    io.to(to).emit('answer', {
      sdp,
      from: socket.id
    });
  });

  // Relay ICE candidate
  socket.on('ice-candidate', ({ candidate, to }) => {
    // candidate is { candidate, sdpMid, sdpMLineIndex }
    io.to(to).emit('ice-candidate', {
      candidate,
      from: socket.id
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;
    console.log(`❌ Socket disconnected: ${socket.id} (${userId || 'no-user'})`);

    if (roomId && rooms.has(roomId)) {
      const participants = rooms.get(roomId);
      participants.delete(socket.id);

      // Notify other peer that this one left
      socket.to(roomId).emit('peer-left', { socketId: socket.id, userId });

      if (participants.size === 0) {
        rooms.delete(roomId);
        console.log(`🗑️ Room ${roomId} removed`);
      }
    }
  });
});



const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
});
