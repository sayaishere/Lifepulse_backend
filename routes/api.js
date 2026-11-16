const router = require('express').Router();
const nodemailer = require('nodemailer');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');

// Configure Nodemailer transporter (uses .env EMAIL_USER & EMAIL_PASS if present)
const createTransporter = () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

// Medical blood compatibility table
const COMPATIBILITY_MAP = {
    'A+': ['A+', 'A-', 'O+', 'O-'],
    'A-': ['A-', 'O-'],
    'B+': ['B+', 'B-', 'O+', 'O-'],
    'B-': ['B-', 'O-'],
    'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    'AB-': ['AB-', 'A-', 'B-', 'O-'],
    'O+': ['O+', 'O-'],
    'O-': ['O-']
};

const getCompatibleDonors = (recipientGroup) => {
    return COMPATIBILITY_MAP[recipientGroup] || [recipientGroup];
};

const isEligibleToDonate = (lastDonationDate) => {
    if (!lastDonationDate) return true;
    const cooldownDays = 90;
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const diff = Date.now() - new Date(lastDonationDate).getTime();
    return diff >= cooldownMs;
};

const getRemainingCooldownDays = (lastDonationDate) => {
    if (!lastDonationDate) return 0;
    const cooldownDays = 90;
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const diff = Date.now() - new Date(lastDonationDate).getTime();
    const remainingMs = cooldownMs - diff;
    return remainingMs > 0 ? Math.ceil(remainingMs / (1000 * 60 * 60 * 24)) : 0;
};

// Auto-reactivate donors whose 90-day medical cooldown has finished
const reactivateEligibleDonors = async (cooldownThreshold) => {
    await User.updateMany(
        {
            role: 'user',
            isAvailable: false,
            lastDonationDate: { $ne: null, $lte: cooldownThreshold }
        },
        { $set: { isAvailable: true } }
    );
};

// Auto-expire Pending / Accepted blood requests older than 24 hours
const expireStaleRequests = async () => {
    const expirationThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await BloodRequest.updateMany(
        {
            status: { $in: ['Pending', 'Accepted'] },
            createdAt: { $lte: expirationThreshold }
        },
        { $set: { status: 'Expired' } }
    );
};

// GET COMPATIBLE DONORS
router.get('/donors/compatible', async (req, res) => {
    try {
        let { bloodGroup, location } = req.query;

        if (!bloodGroup) {
            return res.status(400).json({ message: 'Recipient bloodGroup is required.' });
        }

        bloodGroup = bloodGroup.trim().replace(/\s+/g, '+');
        const compatibleGroups = getCompatibleDonors(bloodGroup);

        const cooldownThreshold = new Date();
        cooldownThreshold.setDate(cooldownThreshold.getDate() - 90);

        await reactivateEligibleDonors(cooldownThreshold);

        let query = {
            role: 'user',
            isAvailable: true,
            bloodGroup: { $in: compatibleGroups },
            $or: [
                { lastDonationDate: null },
                { lastDonationDate: { $lte: cooldownThreshold } }
            ]
        };

        if (location) {
            query.location = { $regex: location, $options: 'i' };
        }

        const donors = await User.find(query).select('-password');

        const formattedDonors = donors.map((donor) => ({
            ...donor.toObject(),
            isDirectMatch: donor.bloodGroup === bloodGroup,
            isCompatibleMatch: donor.bloodGroup !== bloodGroup
        })).sort((a, b) => (a.isDirectMatch === b.isDirectMatch ? 0 : a.isDirectMatch ? -1 : 1));

        res.status(200).json({
            count: formattedDonors.length,
            searchedFor: bloodGroup,
            compatibleGroups,
            donors: formattedDonors
        });
    } catch (err) {
        console.error('Error fetching compatible donors:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET ALL DONORS
router.get('/donors', async (req, res) => {
    try {
        let { bloodGroup, location, includeCooldown } = req.query;
        const cooldownThreshold = new Date();
        cooldownThreshold.setDate(cooldownThreshold.getDate() - 90);

        await reactivateEligibleDonors(cooldownThreshold);

        let query = { role: 'user' };

        if (includeCooldown !== 'true') {
            query.isAvailable = true;
            query.$or = [
                { lastDonationDate: null },
                { lastDonationDate: { $lte: cooldownThreshold } }
            ];
        }

        if (bloodGroup && bloodGroup !== 'All Blood Groups') {
            query.bloodGroup = bloodGroup.trim().replace(/\s+/g, '+');
        }

        if (location) {
            query.location = { $regex: location, $options: 'i' };
        }

        const donors = await User.find(query).select('-password').sort({ createdAt: -1 });
        res.status(200).json(donors);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// MARK DONATION COMPLETED
router.put('/donors/:id/complete-donation', async (req, res) => {
    try {
        const donationDate = req.body.donationDate ? new Date(req.body.donationDate) : new Date();

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            {
                lastDonationDate: donationDate,
                isAvailable: false
            },
            { returnDocument: 'after' }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: 'Donor not found' });
        }

        res.status(200).json({
            message: 'Donation recorded successfully. 90-day cooldown initiated.',
            remainingDays: 90,
            user: updatedUser
        });
    } catch (err) {
        console.error('Error marking donation completed:', err);
        res.status(500).json({ error: err.message });
    }
});

// CHECK DONOR STATUS
router.get('/donors/:id/status', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('lastDonationDate isAvailable bloodGroup name');
        if (!user) {
            return res.status(404).json({ message: 'Donor not found' });
        }

        const eligible = isEligibleToDonate(user.lastDonationDate);
        const remainingDays = getRemainingCooldownDays(user.lastDonationDate);

        if (eligible && !user.isAvailable) {
            user.isAvailable = true;
            await user.save();
        }

        res.status(200).json({
            isEligible: eligible && user.isAvailable,
            remainingDays,
            lastDonationDate: user.lastDonationDate,
            isAvailable: user.isAvailable
        });
    } catch (err) {
        console.error('Error checking donor status:', err);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN: TOGGLE DONOR AVAILABILITY (PRESERVING DONATION HISTORY)
router.put('/donors/:id/availability', async (req, res) => {
    try {
        const { isAvailable } = req.body;
        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            { $set: { isAvailable: Boolean(isAvailable) } },
            { returnDocument: 'after' }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: 'Donor not found.' });
        }

        res.status(200).json({
            message: `Donor status updated to ${updatedUser.isAvailable ? 'Available' : 'Unavailable'}.`,
            user: updatedUser
        });
    } catch (err) {
        console.error('Error updating donor availability:', err);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN: DELETE DONOR / USER
router.delete('/donors/:id', async (req, res) => {
    try {
        const deletedUser = await User.findByIdAndDelete(req.params.id);
        if (!deletedUser) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(200).json({ message: 'User removed successfully.' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: err.message });
    }
});

// BLOOD REQUEST ROUTES
router.post('/requests', async (req, res) => {
    try {
        const newRequest = new BloodRequest(req.body);
        const savedRequest = await newRequest.save();

        // Find compatible & eligible donors in the same location to notify via email
        const compatibleGroups = getCompatibleDonors(savedRequest.bloodGroup);
        const cooldownThreshold = new Date();
        cooldownThreshold.setDate(cooldownThreshold.getDate() - 90);

        await reactivateEligibleDonors(cooldownThreshold);

        const matchingDonors = await User.find({
            role: 'user',
            isAvailable: true,
            bloodGroup: { $in: compatibleGroups },
            ...(savedRequest.location ? { location: { $regex: savedRequest.location.trim(), $options: 'i' } } : {}),
            ...(savedRequest.createdBy ? { _id: { $ne: savedRequest.createdBy } } : {}),
            $or: [
                { lastDonationDate: null },
                { lastDonationDate: { $lte: cooldownThreshold } }
            ]
        }).select('name email bloodGroup');

        // Dispatch emergency alert emails asynchronously (non-blocking)
        const transporter = createTransporter();
        if (matchingDonors.length > 0) {
            if (transporter) {
                Promise.allSettled(
                    matchingDonors.map((donor) =>
                        transporter.sendMail({
                            from: `"LifePulse Emergency Network" <${process.env.EMAIL_USER}>`,
                            to: donor.email,
                            subject: `🚨 URGENT: ${savedRequest.bloodGroup} Blood Needed at ${savedRequest.hospitalName}`,
                            html: `
                                <div style="font-family: Arial, sans-serif; padding: 20px; background: #111; color: #fff; border-radius: 12px;">
                                    <h2 style="color: #ef4444; margin-top: 0;">Emergency Blood Request (${savedRequest.bloodGroup})</h2>
                                    <p>Hi <strong>${donor.name}</strong>, your blood group (<strong>${donor.bloodGroup}</strong>) is compatible for an urgent patient request:</p>
                                    <ul style="line-height: 1.7;">
                                        <li><strong>Patient:</strong> ${savedRequest.patientName}</li>
                                        <li><strong>Units Needed:</strong> ${savedRequest.unitsNeeded}</li>
                                        <li><strong>Hospital:</strong> ${savedRequest.hospitalName}, ${savedRequest.location}</li>
                                        <li><strong>Contact Phone:</strong> ${savedRequest.contactPhone}</li>
                                    </ul>
                                    <p>Open <strong>LifePulse</strong> to accept this request or call the contact immediately.</p>
                                </div>
                            `
                        })
                    )
                ).catch((mailErr) => console.error('Email blast warning:', mailErr.message));
            } else {
                console.log(
                    `[LifePulse Email Alert Preview] Notified ${matchingDonors.length} compatible donors (${matchingDonors.map((d) => d.email).join(', ')}) for ${savedRequest.bloodGroup} request.`
                );
            }
        }

        res.status(201).json({
            message: 'Blood request posted successfully!',
            notifiedCount: matchingDonors.length,
            request: savedRequest
        });
    } catch (err) {
        console.error('Error saving request:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/requests', async (req, res) => {
    try {
        await expireStaleRequests();
        const requests = await BloodRequest.find().sort({ createdAt: -1 });
        res.status(200).json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ACCEPT OR DECLINE A BLOOD REQUEST
router.put('/requests/:id/respond', async (req, res) => {
    try {
        const { donorId, donorName, donorPhone, donorEmail, action } = req.body;

        if (!donorId || !['accept', 'decline'].includes(action)) {
            return res.status(400).json({ message: 'Valid donorId and action (accept/decline) are required.' });
        }

        await expireStaleRequests();

        const bloodRequest = await BloodRequest.findById(req.params.id);
        if (!bloodRequest) {
            return res.status(404).json({ message: 'Blood request not found.' });
        }

        if (['Completed', 'Cancelled', 'Expired'].includes(bloodRequest.status)) {
            return res.status(400).json({ message: `This request is already ${bloodRequest.status}.` });
        }

        if (action === 'accept') {
            const donor = await User.findById(donorId);

            // 1. Check donor 90-day medical cooldown before allowing acceptance
            if (donor && !isEligibleToDonate(donor.lastDonationDate)) {
                return res.status(403).json({
                    message: 'You are currently in your 90-day recovery cooldown and cannot accept requests.'
                });
            }

            // 2. Enforce One Active Commitment Rule
            const existingCommitment = await BloodRequest.findOne({
                _id: { $ne: req.params.id },
                status: { $in: ['Pending', 'Accepted'] },
                'acceptedBy.donorId': donorId
            });

            if (existingCommitment) {
                return res.status(400).json({
                    message: `You already have an active commitment for ${existingCommitment.patientName}.`
                });
            }

            // 3. Enforce Medical Blood Compatibility
            const allowedDonors = getCompatibleDonors(bloodRequest.bloodGroup);
            if (donor && !allowedDonors.includes(donor.bloodGroup)) {
                return res.status(400).json({
                    message: `Blood group ${donor.bloodGroup} is not medically compatible with ${bloodRequest.bloodGroup}.`
                });
            }

            // Remove from declinedBy if previously declined
            bloodRequest.declinedBy = bloodRequest.declinedBy.filter(
                (id) => id.toString() !== donorId.toString()
            );

            // Prevent duplicate acceptance by same donor
            const alreadyAccepted = bloodRequest.acceptedBy.some(
                (entry) => entry.donorId && entry.donorId.toString() === donorId.toString()
            );

            if (!alreadyAccepted) {
                bloodRequest.acceptedBy.push({
                    donorId,
                    donorName: donorName || donor?.name || 'Verified Donor',
                    donorPhone: donorPhone || donor?.phone || '',
                    donorEmail: donorEmail || donor?.email || ''
                });
            }

            bloodRequest.status = 'Accepted';
        } else if (action === 'decline') {
            // Remove from acceptedBy if previously accepted
            bloodRequest.acceptedBy = bloodRequest.acceptedBy.filter(
                (entry) => !(entry.donorId && entry.donorId.toString() === donorId.toString())
            );

            if (!bloodRequest.declinedBy.some((id) => id.toString() === donorId.toString())) {
                bloodRequest.declinedBy.push(donorId);
            }

            if (bloodRequest.acceptedBy.length === 0) {
                bloodRequest.status = 'Pending';
            }
        }

        const updatedRequest = await bloodRequest.save();
        res.status(200).json({
            message: action === 'accept' ? 'You accepted this blood request!' : 'Request declined.',
            request: updatedRequest
        });
    } catch (err) {
        console.error('Error responding to blood request:', err);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE BLOOD REQUEST STATUS (Pending / Accepted / Completed / Cancelled / Expired)
router.put('/requests/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const allowedStatuses = ['Pending', 'Accepted', 'Completed', 'Cancelled', 'Expired'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status value.' });
        }

        const bloodRequest = await BloodRequest.findById(req.params.id);
        if (!bloodRequest) {
            return res.status(404).json({ message: 'Blood request not found.' });
        }

        bloodRequest.status = status;

        // If marked Completed, start 90-day cooldown for the accepting donor(s)
        if (status === 'Completed' && Array.isArray(bloodRequest.acceptedBy) && bloodRequest.acceptedBy.length > 0) {
            const donorIds = bloodRequest.acceptedBy.map((entry) => entry.donorId).filter(Boolean);
            if (donorIds.length > 0) {
                await User.updateMany(
                    { _id: { $in: donorIds } },
                    { lastDonationDate: new Date(), isAvailable: false }
                );
            }
        }

        const updatedRequest = await bloodRequest.save();
        res.status(200).json({
            message: `Request status updated to ${status}.`,
            request: updatedRequest
        });
    } catch (err) {
        console.error('Error updating request status:', err);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN: DELETE BLOOD REQUEST
router.delete('/requests/:id', async (req, res) => {
    try {
        const deletedRequest = await BloodRequest.findByIdAndDelete(req.params.id);
        if (!deletedRequest) {
            return res.status(404).json({ message: 'Blood request not found.' });
        }
        res.status(200).json({ message: 'Blood request deleted successfully.' });
    } catch (err) {
        console.error('Error deleting blood request:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;