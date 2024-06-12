const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { VoiceResponse } = require('twilio').twiml;

const apiKey = "sk_55b553453cf543178bb29583420a683a32a61e32550d8468";
const audioFileName = 'output.mp3';
const audioFilePath = path.join(__dirname, audioFileName);

async function convertTextToSpeech(text) {
    try {
        const response = await axios.post(
            'https://api.elevenlabs.io/v1/text-to-speech/NihRgaLj2HWAjvZ5XNxl',
            { text: text },
            {
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            }
        );

        fs.writeFileSync(audioFilePath, response.data);

        console.log('Audio file saved to', audioFilePath);
    } catch (error) {
        console.error('Error converting text to speech:', error);
    }
}


const app = express();

app.post("/voice", async (req, res) => {
    const twiml = new VoiceResponse();

    const text = 'Bună ziua!';

    await convertTextToSpeech(text);

    twiml.play({}, audioFileName);

    res.type('text/xml');
    res.send(twiml.toString());
});

app.get(`/${audioFileName}`, (req, res) => {
    res.sendFile(audioFilePath);
});

function startServer() {
    const port = process.env.PORT || 1337;

    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
}

startServer();
