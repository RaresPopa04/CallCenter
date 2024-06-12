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

async function startServer() {
    // await convertTextToSpeech('Hello World!');

    const app = express();

    app.post('/voice', (req, res) => {
        console.log('Incoming POST request from Twilio:', req.body);
        const twiml = new VoiceResponse();
        twiml.play({ loop: 1 }, `http://localhost:1337/${audioFileName}`);

        console.log('Twiml response:', twiml.toString());
        
        res.type('text/xml');
        res.send(twiml.toString());
    });

    app.get(`/${audioFileName}`, (req, res) => {
        res.sendFile(audioFilePath);
    });

    app.listen(1337, () => {
        console.log('Express server listening on port 1337');
    });
}

startServer();
