const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./auth"); // ✅ Import auth routes
const User = require("./usermodel");  // ✅ Import User model

const app = express();
app.use(cors());
app.use(express.json());

// ✅ MongoDB Connection
mongoose
  .connect("mongodb://localhost:27017/chatApp2", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log(err));

// ✅ Routes
app.use("/auth", authRoutes); // /auth/register , /auth/login

// ✅ Message Schema
const messageSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

// ✅ HTTP + Socket setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

// ✅ Store active users
const activeUsers = new Map();

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

// ✅ Socket Events
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register_user", async (username) => {
    activeUsers.set(socket.id, username);

    await User.findOneAndUpdate(
      { username },
      { isOnline: true, lastSeen: new Date() },
      { upsert: true, new: true }
    );

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

    const receiverSocketId = Array.from(activeUsers.entries()).find(
      ([, name]) => name === data.receiver
    )?.[0];

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receive_message", newMessage);
    }
  });

  socket.on("user_logout", async (username) => {
    await User.findOneAndUpdate(
      { username },
      { isOnline: false, lastSeen: new Date() }
    );

    activeUsers.delete(socket.id);

    const allUsers = await User.find({}).sort({ isOnline: -1, username: 1 });
    io.emit("users_update", allUsers);
  });

  socket.on("disconnect", async () => {
    const username = activeUsers.get(socket.id);
    if (username) {
      await User.findOneAndUpdate(
        { username },
        { isOnline: false, lastSeen: new Date() }
      );
      activeUsers.delete(socket.id);

      const allUsers = await User.find({}).sort({ isOnline: -1, username: 1 });
      io.emit("users_update", allUsers);
    }
  });
});

// ✅ Start server
server.listen(5000, () => console.log("🚀 Server running on port 5000"));
