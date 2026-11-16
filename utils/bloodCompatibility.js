// Medical blood compatibility table
// Key: Patient Blood Group -> Value: Array of compatible donor blood groups
const COMPATIBILITY_MAP = {
    'A+': ['A+', 'A-', 'O+', 'O-'],
    'A-': ['A-', 'O-'],
    'B+': ['B+', 'B-', 'O+', 'O-'],
    'B-': ['B-', 'O-'],
    'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], // Universal Recipient
    'AB-': ['AB-', 'A-', 'B-', 'O-'],
    'O+': ['O+', 'O-'],
    'O-': ['O-'] // Universal Donor
};

/**
 * Returns an array of compatible donor blood groups for a given recipient type.
 */
const getCompatibleDonors = (recipientGroup) => {
    return COMPATIBILITY_MAP[recipientGroup] || [recipientGroup];
};

/**
 * Checks if a donor has completed their 90-day cooldown period.
 */
const isEligibleToDonate = (lastDonationDate) => {
    if (!lastDonationDate) return true;
    const cooldownDays = 90;
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const diff = Date.now() - new Date(lastDonationDate).getTime();
    return diff >= cooldownMs;
};

/**
 * Calculates remaining cooldown days. Returns 0 if eligible.
 */
const getRemainingCooldownDays = (lastDonationDate) => {
    if (!lastDonationDate) return 0;
    const cooldownDays = 90;
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const diff = Date.now() - new Date(lastDonationDate).getTime();
    const remainingMs = cooldownMs - diff;
    return remainingMs > 0 ? Math.ceil(remainingMs / (1000 * 60 * 60 * 24)) : 0;
};

module.exports = {
    getCompatibleDonors,
    isEligibleToDonate,
    getRemainingCooldownDays
};