const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    bloodGroup: { type: String, required: true }, // e.g., 'O+', 'A-', etc.
    location: { type: String, required: true },   // e.g., 'Kozhikode'
    lastDonationDate: { type: Date, default: null },
    isAvailable: { type: Boolean, default: true }, // 90-day cooldown tracker flag
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);