require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const chatRoutes = require('./routes/chat');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes Middleware
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/chat', chatRoutes);

// Connect to Local MongoDB Compass
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully to Compass!'))
    .catch((err) => console.log('MongoDB Connection Error:', err));

// Test Route
app.get('/', (req, res) => {
    res.send('LifePulse Backend is Running!');
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});