const router = require('express').Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Helper function to create transporter on-demand with explicit Gmail SMTP host & port
const createTransporter = () => {
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // true for port 465
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

// REGISTER USER / DONOR (WITH AUTO-LOGIN TOKEN)
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, phone, bloodGroup, location } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'User already exists with this email.' });

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const newUser = new User({
            name,
            email,
            password: hashedPassword,
            phone,
            bloodGroup,
            location,
            lastDonationDate: null,
            isAvailable: true
        });

        const savedUser = await newUser.save();

        // Issue JWT token immediately for auto-login
        const token = jwt.sign({ id: savedUser._id, role: savedUser.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(201).json({
            message: 'User registered successfully!',
            token,
            user: {
                id: savedUser._id,
                name: savedUser.name,
                email: savedUser.email,
                bloodGroup: savedUser.bloodGroup,
                location: savedUser.location,
                role: savedUser.role,
                isAvailable: savedUser.isAvailable,
                lastDonationDate: savedUser.lastDonationDate
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LOGIN USER
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });

        // Generate JWT Token
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(200).json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                bloodGroup: user.bloodGroup,
                location: user.location,
                role: user.role,
                isAvailable: user.isAvailable !== false,
                lastDonationDate: user.lastDonationDate
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// FORGOT PASSWORD (REQUEST RESET LINK)
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: 'Email is required.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'No account found with this email.' });
        }

        // Verify environment variables are loaded
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.error('Missing EMAIL_USER or EMAIL_PASS in environment variables.');
            return res.status(500).json({ message: 'Email service is not properly configured.' });
        }

        // Generate secure random token
        const rawToken = crypto.randomBytes(32).toString('hex');

        // Store SHA-256 hash in database with 15-minute expiration
        user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
        await user.save();

        // Dynamically detects whatever port Vite opens on (5173 or 5174)
        const clientOrigin = req.headers.origin || process.env.CLIENT_URL || 'http://localhost:5173';
        const resetUrl = `${clientOrigin}/reset-password/${rawToken}`;

        const transporter = createTransporter();

        const mailOptions = {
            from: `"LifePulse Support" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: 'LifePulse - Password Reset Request',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
                    <h2 style="color: #dc2626; margin-top: 0;">🩸 LifePulse Support</h2>
                    <p style="color: #374151; font-size: 15px;">Hello <strong>${user.name || 'User'}</strong>,</p>
                    <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">
                        We received a request to reset your password. Click the button below to choose a new password. This link is valid for <strong>15 minutes</strong>:
                    </p>
                    <div style="text-align: center; margin: 26px 0;">
                        <a href="${resetUrl}" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                            Reset Password
                        </a>
                    </div>
                    <p style="color: #6b7280; font-size: 12px; line-height: 1.4;">
                        If the button doesn't work, copy and paste this link into your browser:
                        <br/>
                        <a href="${resetUrl}" style="color: #dc2626;">${resetUrl}</a>
                    </p>
                    <p style="color: #9ca3af; font-size: 11px; margin-top: 20px;">
                        If you didn't request this, you can safely ignore this email.
                    </p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: 'Password reset link sent to your email!' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ message: 'Failed to send reset email. Please try again.' });
    }
});

// RESET PASSWORD (SUBMIT NEW PASSWORD)
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        if (!password || password.length < 4) {
            return res.status(400).json({ message: 'Password must be at least 4 characters long.' });
        }

        // Hash token to look up in DB
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Reset link is invalid or has expired.' });
        }

        // Hash new password using bcrypt
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        // Clear reset fields
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();

        res.status(200).json({ message: 'Password has been successfully updated! You can now log in.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ message: 'Server error resetting password.' });
    }
});

// GET USER PROFILE
router.get('/profile/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.status(200).json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE USER PROFILE & AVAILABILITY
router.put('/profile/:id', async (req, res) => {
    try {
        const { bloodGroup, lastDonationDate, isAvailable, location } = req.body;

        const updateData = {
            bloodGroup,
            isAvailable,
            lastDonationDate: lastDonationDate ? new Date(lastDonationDate) : null
        };

        if (location) {
            updateData.location = location;
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            updateData,
            { returnDocument: 'after' }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;