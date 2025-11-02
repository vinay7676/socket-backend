// server.js
require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log(err));

// ✅ Message Schema
const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

// ✅ User Schema - to track all users (online and offline)
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

// ✅ HTTP + Socket setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

// ✅ Store active users
const activeUsers = new Map(); // socketId -> username

// ✅ REST API to get messages between two users
app.get("/messages/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params;
  const messages = await Message.find({
    $or: [
      { sender: user1, receiver: user2 },
      { sender: user2, receiver: user1 },
    ],
  }).sort({ timestamp: 1 });
  res.json(messages);
});

// ✅ Get all users (online and offline)
app.get("/users", async (req, res) => {
  const users = await User.find({}).sort({ isOnline: -1, username: 1 });
  res.json(users);
});

// ✅ Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ✅ Socket Events
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register_user", async (username) => {
    activeUsers.set(socket.id, username);
    
    // Update or create user in database
    await User.findOneAndUpdate(
      { username },
      { isOnline: true, lastSeen: new Date() },
      { upsert: true, new: true }
    );
    
    console.log(`User ${username} registered with socket ${socket.id}`);
    
    // Broadcast updated user list to all clients
    const allUsers = await User.find({}).sort({ isOnline: -1, username: 1 });
    io.emit("users_update", allUsers);
  });

  socket.on("send_message", async (data) => {
    const newMessage = new Message({
      sender: data.sender,
      receiver: data.receiver,
      message: data.message,
    });
    await newMessage.save();

    // Find receiver's socket ID
    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([_, username]) => username === data.receiver
    )?.[0];

    // Send to receiver only
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receive_message", newMessage);
    }
  });

  socket.on("user_logout", async (username) => {
    // Set user as offline
    await User.findOneAndUpdate(
      { username },
      { isOnline: false, lastSeen: new Date() }
    );
    
    activeUsers.delete(socket.id);
    console.log(`User ${username} logged out`);
    
    // Broadcast updated user list
    const allUsers = await User.find({}).sort({ isOnline: -1, username: 1 });
    io.emit("users_update", allUsers);
  });

  socket.on("disconnect", async () => {
    const username = activeUsers.get(socket.id);
    if (username) {
      // Set user as offline
      await User.findOneAndUpdate(
        { username },
        { isOnline: false, lastSeen: new Date() }
      );
      
      activeUsers.delete(socket.id);
      console.log("User disconnected:", socket.id);
      
      // Broadcast updated user list
      const allUsers = await User.find({}).sort({ isOnline: -1, username: 1 });
      io.emit("users_update", allUsers);
    }
  });
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));