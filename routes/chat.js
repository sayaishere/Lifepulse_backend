const express = require('express');
const router = express.Router();

// 1. Website Platform Rules (Instant Predefined Answers)
function getOfflineAnswer(query) {
    const q = (query || '').toLowerCase().trim();

    // Greetings
    if (/^(hi|hello|hey|hey there)\b/i.test(q)) {
        return "Hi there! Welcome to LifePulse. How can I assist you with donor searches or donation guidelines today?";
    }

    // Eligibility
    if (q.includes('eligib') || q.includes('criteria') || q.includes('who can donate')) {
        return "Basic Blood Donation Criteria:\n• Age: 18–65 years\n• Weight: Minimum 45–50 kg\n• Hemoglobin: At least 12.5 g/dL\n• Cooldown: 90 days (3 months) since last whole blood donation\n• Health: Free from active acute illness or fever.";
    }

    // Request Blood
    if (q.includes('request blood') || q.includes('post request') || q.includes('how to request')) {
        return "To Request Blood on LifePulse:\n1. Click '+ Post Request' in the navigation bar.\n2. Enter the patient details, required blood group, hospital name, and units.\n3. Submit to broadcast the emergency alert to nearby matching donors.";
    }

    // Find Donors
    if (q.includes('find') && (q.includes('donor') || q.includes('search'))) {
        return "To find nearby donors, go to 'Find Donors' or use the Home search bar. Choose the blood group (like O+) and enter your location to view eligible matches.";
    }

    // Blood Compatibility
    if (q.includes('compatibility') || q.includes('compatible blood')) {
        return "Blood Compatibility Quick Reference:\n• O- : Universal Red Cell Donor (donates to all)\n• AB+ : Universal Recipient (receives from all)\n• O+ : Donates to O+, A+, B+, AB+ | Receives from O+, O-\n• A+ : Donates to A+, AB+ | Receives from A+, A-, O+, O-\n• B+ : Donates to B+, AB+ | Receives from B+, B-, O+, O-";
    }

    return null;
}


// 2. Chat Endpoint
router.post('/', async (req, res) => {

    try {
        const { message } = req.body;

        if (typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({
                error: 'Message cannot be empty.'
            });
        }

        // Check predefined answers first
        const offlineReply = getOfflineAnswer(message);

        if (offlineReply) {
            return res.status(200).json({
                success: true,
                reply: offlineReply,
                source: 'platform'
            });
        }

        // Check API key
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                error: 'GEMINI_API_KEY is missing in .env'
            });
        }

        // Import Gemini SDK
        const { GoogleGenAI } = await import('@google/genai');

        const ai = new GoogleGenAI({
            apiKey: apiKey,
            httpOptions: {
                timeout: 20000
            }
        });

        // Prompt
        const prompt = `
You are a blood donation assistant for the LifePulse app.

Answer general blood donation questions simply and accurately.

Rules:
1. Give only 1 or 2 short numbered points.
2. Prefer one point whenever possible.
3. Avoid long paragraphs.
4. Stay focused on blood donation and related health questions.
5. Recommend a healthcare professional when personal medical advice is needed.

Question: ${message}
`;

        console.log('Sending request to Gemini...');

        console.time('Gemini Response Time');

        let response;

        try {
            response = await ai.models.generateContent({
                model: 'gemini-3.5-flash-lite',
                contents: prompt,
                config: {
                    maxOutputTokens: 150
                }
            });
        } finally {
            console.timeEnd('Gemini Response Time');
        }

        console.log('Gemini response received!');

        const content = response.text;

        if (!content) {
            throw new Error('Gemini returned an empty response.');
        }

        return res.status(200).json({
            success: true,
            reply: content.trim(),
            source: 'ai'
        });

    } catch (err) {

        console.error('Gemini Error:', err);
        console.error('Underlying Cause:', err.cause);

        return res.status(err.status === 503 ? 503 : 500).json({
            error: 'Failed to generate AI response',
            details: err.message
        });
    }

});

module.exports = router;
