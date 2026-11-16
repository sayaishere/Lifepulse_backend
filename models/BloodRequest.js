const mongoose = require('mongoose');

const bloodRequestSchema = new mongoose.Schema({
    patientName: { type: String, required: true },
    bloodGroup: { type: String, required: true },
    unitsNeeded: { type: Number, required: true },
    priorityLevel: { type: String, enum: ['Emergency (Immediate)', 'Urgent', 'Standard'], default: 'Emergency (Immediate)' },
    hospitalName: { type: String, required: true },
    location: { type: String, required: true },
    contactPhone: { type: String, required: true },
    additionalNotes: { type: String },
    status: { type: String, enum: ['Pending', 'Accepted', 'Completed', 'Cancelled', 'Expired'], default: 'Pending' },
    acceptedBy: [
        {
            donorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            donorName: { type: String },
            donorPhone: { type: String },
            donorEmail: { type: String },
            acceptedAt: { type: Date, default: Date.now }
        }
    ],
    declinedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now, expires: 86400 } // Automatically expires/deletes in 24 hours (86400 seconds) as required!
}, { timestamps: true });

module.exports = mongoose.model('BloodRequest', bloodRequestSchema);